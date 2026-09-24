import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
// The same rules the server applies (migration 20260927000100, b2c.js), so
// the plan the owner confirms is the payout the server will make.
import {
  payoutAmount,
  payoutBlocker,
  toMsisdn,
} from '../../../../../supabase/functions/_shared/mpesa/b2c.js'

/**
 * M-Pesa B2C salary payouts. Requesting one is a local insert naming the
 * payslip line; sync carries it up, the server fixes the amount and phone,
 * sends it, and the outcome syncs back. Nothing here touches the network.
 */

export type PayoutStatus = 'queued' | 'sending' | 'accepted' | 'paid' | 'failed' | 'unknown'

export interface PayoutLine {
  itemId: string
  employeeName: string
  msisdn: string | null
  amountShillings: number
  remainderCents: number
  /** Why this line will not be sent by M-Pesa; null when it will. */
  blocker: string | null
  /** The latest payout for this line, if one was requested. */
  payout: { status: PayoutStatus; receipt: string | null; detail: string | null } | null
}

export interface PayoutPlan {
  lines: PayoutLine[]
  /** Lines that will be sent now. */
  payable: PayoutLine[]
  totalShillings: number
}

/** A payout that may already be moving money; its line cannot be sent again. */
const LIVE: readonly PayoutStatus[] = ['queued', 'sending', 'accepted', 'unknown', 'paid']

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
      `SELECT i.id AS item_id, i.net_pay_cents, i.paid_at,
              e.full_name, e.phone, e.payment_method,
              p.status AS payout_status, p.mpesa_receipt, p.result_desc
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
      const status = (row['payout_status'] as PayoutStatus | null) ?? null
      const isLive = status !== null && LIVE.includes(status)
      const { amountShillings, remainderCents } = payoutAmount(netPayCents)
      const ruleBlocker = payoutBlocker({
        netPayCents,
        msisdn,
        paymentMethod: (row['payment_method'] as string | null) ?? null,
        isPaid: row['paid_at'] !== null,
      })
      return {
        itemId: String(row['item_id']),
        employeeName: String(row['full_name'] ?? 'Unknown employee'),
        msisdn,
        amountShillings,
        remainderCents,
        blocker: isLive && status !== 'paid' ? 'Payment already requested.' : ruleBlocker,
        payout: status
          ? {
              status,
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
      throw new PayoutRuleError('There is no one left to pay by M-Pesa in this run.')
    }
    const typed = Number(typedTotal.replace(/[,\s]/g, ''))
    if (!Number.isFinite(typed) || typed !== plan.totalShillings) {
      throw new PayoutRuleError(
        `Type the total exactly as shown (${plan.totalShillings.toLocaleString('en-KE')}) to confirm.`,
      )
    }

    // The amount and phone travel only as a local preview; the server
    // replaces both from the approved run (app.prepare_payroll_payout).
    for (const line of plan.payable) {
      await this.payouts.insert({
        id: newId(),
        payroll_run_id: runId,
        payroll_item_id: line.itemId,
        amount_cents: line.amountShillings * 100,
        remainder_cents: line.remainderCents,
        msisdn: line.msisdn,
        status: 'queued',
        attempts: 0,
      })
    }
    return plan.payable.length
  }
}
