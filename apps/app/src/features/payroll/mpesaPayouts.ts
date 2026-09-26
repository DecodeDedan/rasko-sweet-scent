import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
// The same rules the server applies (migrations 20260927000100 and
// 20260929000100, rules.js), so the plan the owner confirms is the payout the
// server will make.
import {
  bankAccount,
  bankName,
  payoutAmount,
  payoutBlocker,
  toMsisdn,
} from '../../../../../supabase/functions/_shared/payouts/rules.js'

/**
 * Salary payouts, by M-Pesa or bank transfer. Requesting one is a local insert
 * naming the payslip line; sync carries it up, the server fixes the amount,
 * channel and destination, sends it through the configured provider (Daraja
 * or IntaSend), and the outcome syncs back. Nothing here touches the network.
 * (The name predates bank payouts.)
 */

export type PayoutStatus = 'queued' | 'sending' | 'accepted' | 'paid' | 'failed' | 'unknown'

export type PayoutChannel = 'mpesa' | 'bank'

export interface PayoutLine {
  itemId: string
  employeeId: string | null
  employeeName: string
  channel: PayoutChannel | null
  /** Where the money goes: the M-Pesa number, or "Equity Bank ···6789". */
  destination: string | null
  msisdn: string | null
  amountShillings: number
  remainderCents: number
  /** Why this line will not be paid out; null when it will. */
  blocker: string | null
  /**
   * The blocker is missing or wrong details on the employee record (no phone,
   * no bank account, no payment method), which the owner can fix there.
   */
  needsDetails: boolean
  /** The latest payout for this line, if one was requested. */
  payout: {
    status: PayoutStatus
    channel: PayoutChannel
    receipt: string | null
    detail: string | null
  } | null
}

export interface PayoutPlan {
  lines: PayoutLine[]
  /** Lines that will be sent now. */
  payable: PayoutLine[]
  totalShillings: number
}

/** A payout that may already be moving money; its line cannot be sent again. */
const LIVE: readonly PayoutStatus[] = ['queued', 'sending', 'accepted', 'unknown', 'paid']
/** Still on its way to a final answer: worth asking the server again soon. */
const IN_FLIGHT: readonly PayoutStatus[] = ['queued', 'sending', 'accepted']

export function hasPayoutsInFlight(plan: PayoutPlan): boolean {
  return plan.lines.some((line) => line.payout !== null && IN_FLIGHT.includes(line.payout.status))
}

/**
 * How many shillings the wallet is short of the run, or 0 when it covers it.
 * Provider fees come out of the wallet on top, so covering the total exactly
 * can still fall short; IntaSend then refuses the line without moving money.
 */
export function walletShortfall(totalShillings: number, availableCents: number): number {
  return Math.max(0, Math.ceil((totalShillings * 100 - availableCents) / 100))
}

/** payment_details arrives as JSON text from SQLite, or already parsed. */
function parseDetails(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export class PayoutRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutRuleError'
  }
}

export class MpesaPayoutsRepository {
  private readonly payouts: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    context: WriteContext,
  ) {
    this.payouts = new Repository(db, 'payroll_payouts', context)
  }

  async plan(runId: string): Promise<PayoutPlan> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT i.id AS item_id, i.employee_id, i.net_pay_cents, i.paid_at,
              e.full_name, e.phone, e.payment_method, e.payment_details,
              p.status AS payout_status, p.channel AS payout_channel,
              p.mpesa_receipt, p.result_desc
         FROM payroll_items i
         LEFT JOIN employees e ON e.id = i.employee_id
         LEFT JOIN payroll_payouts p ON p.id = (
           SELECT id FROM payroll_payouts q
            WHERE q.payroll_item_id = i.id AND q.deleted_at IS NULL
            ORDER BY q.created_at DESC LIMIT 1)
        WHERE i.payroll_run_id = ? AND i.deleted_at IS NULL
        ORDER BY e.full_name COLLATE NOCASE`,
      [runId],
    )

    const lines = rows.map((row): PayoutLine => {
      const netPayCents = Number(row['net_pay_cents'] ?? 0)
      const msisdn = toMsisdn(row['phone'] as string | null)
      const method = (row['payment_method'] as string | null) ?? null
      const channel: PayoutChannel | null = method === 'mpesa' || method === 'bank' ? method : null
      const bank = bankAccount(parseDetails(row['payment_details']))
      const status = (row['payout_status'] as PayoutStatus | null) ?? null
      const isLive = status !== null && LIVE.includes(status)
      const { amountShillings, remainderCents } = payoutAmount(netPayCents)
      const ruleBlocker = payoutBlocker({
        netPayCents,
        msisdn,
        paymentMethod: method,
        isPaid: row['paid_at'] !== null,
        bank,
      })
      const isPaid = row['paid_at'] !== null
      const needsDetails =
        !isPaid &&
        !isLive &&
        (channel === null || (channel === 'mpesa' && !msisdn) || (channel === 'bank' && !bank))
      return {
        itemId: String(row['item_id']),
        employeeId: (row['employee_id'] as string | null) ?? null,
        needsDetails,
        employeeName: String(row['full_name'] ?? 'Unknown employee'),
        channel,
        destination:
          channel === 'bank'
            ? bank
              ? `${bankName(bank.bankCode) ?? `Bank ${bank.bankCode}`} ···${bank.accountNumber.slice(-4)}`
              : null
            : msisdn,
        msisdn,
        amountShillings,
        remainderCents,
        blocker: isLive && status !== 'paid' ? 'Payment already requested.' : ruleBlocker,
        payout: status
          ? {
              status,
              channel: row['payout_channel'] === 'bank' ? 'bank' : 'mpesa',
              receipt: (row['mpesa_receipt'] as string | null) ?? null,
              detail: (row['result_desc'] as string | null) ?? null,
            }
          : null,
      }
    })

    const payable = lines.filter((line) => line.blocker === null)
    return {
      lines,
      payable,
      totalShillings: payable.reduce((sum, line) => sum + line.amountShillings, 0),
    }
  }

  /**
   * Queues a payout for every payable line. `typedTotal` is the total the
   * owner typed to confirm: it must match to the shilling, so a stale screen or
   * a slip of the finger cannot send a different sum than the one they read.
   */
  async request(runId: string, typedTotal: string, newId: () => string): Promise<number> {
    if (this.role !== 'owner') {
      throw new PayoutRuleError('Only the owner can pay salaries (FR-8.5, FR-8.7).')
    }
    const [run] = await this.db.select<{ status: string }>(
      'SELECT status FROM payroll_runs WHERE id = ? AND deleted_at IS NULL',
      [runId],
    )
    if (!run || (run.status !== 'approved' && run.status !== 'paid')) {
      throw new PayoutRuleError('Approve the payroll run before paying it.')
    }

    const plan = await this.plan(runId)
    if (plan.payable.length === 0) {
      throw new PayoutRuleError('There is no one left to pay in this run.')
    }
    const typed = Number(typedTotal.replace(/[,\s]/g, ''))
    if (!Number.isFinite(typed) || typed !== plan.totalShillings) {
      throw new PayoutRuleError(
        `Type the total exactly as shown (${plan.totalShillings.toLocaleString('en-KE')}) to confirm.`,
      )
    }

    // The amount, channel and destination travel only as a local preview; the
    // server replaces them all from the approved run (app.prepare_payroll_payout).
    for (const line of plan.payable) {
      await this.payouts.insert({
        id: newId(),
        payroll_run_id: runId,
        payroll_item_id: line.itemId,
        amount_cents: line.amountShillings * 100,
        remainder_cents: line.remainderCents,
        msisdn: line.channel === 'mpesa' ? line.msisdn : null,
        channel: line.channel ?? 'mpesa',
        status: 'queued',
        attempts: 0,
      })
    }
    return plan.payable.length
  }
}
