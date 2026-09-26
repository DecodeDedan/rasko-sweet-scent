'use client'

import { Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Field, Input, Modal, StatusChip, formatKes, useToast } from '@rasko/ui'
import type { StatusTone } from '@rasko/ui'

import { useAuth, useIdentity } from '../../auth/AuthProvider.js'
import { newId } from '../../data/ids.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { MpesaPayoutsRepository, hasPayoutsInFlight, walletShortfall } from './mpesaPayouts.js'
import type { PayoutLine, PayoutPlan, PayoutStatus } from './mpesaPayouts.js'

const STATUS: Record<PayoutStatus, { label: string; tone: StatusTone }> = {
  queued: { label: 'Waiting to send', tone: 'neutral' },
  sending: { label: 'Sending', tone: 'neutral' },
  accepted: { label: 'Awaiting confirmation', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Not paid', tone: 'danger' },
  unknown: { label: 'Check statement', tone: 'warning' },
}

/**
 * While a payout is on its way, the dialog asks the server this often, so a
 * line turns Paid in seconds instead of at the next five-minute sync. Only
 * while the dialog is open and something is in flight.
 */
const POLL_MS = 15_000

const shillings = (value: number) => `KES ${value.toLocaleString('en-KE')}`

const CHANNEL_LABEL = { mpesa: 'M-Pesa', bank: 'Bank transfer' } as const

function lineDetail(line: PayoutLine): string {
  const via = line.channel
    ? `${CHANNEL_LABEL[line.channel]}${line.destination ? ` to ${line.destination}` : ''}`
    : ''
  const parts = [line.blocker ?? via]
  if (!line.blocker && line.remainderCents > 0) {
    parts.push(`${formatKes(line.remainderCents)} not sent (payouts are whole shillings)`)
  }
  if (line.payout?.status === 'paid' && line.payout.receipt) {
    parts.push(`${line.payout.channel === 'bank' ? 'Reference' : 'Receipt'} ${line.payout.receipt}`)
  }
  if (
    (line.payout?.status === 'failed' || line.payout?.status === 'unknown') &&
    line.payout.detail
  ) {
    parts.push(line.payout.detail)
  }
  return parts.filter(Boolean).join(' · ')
}

function progressSummary(plan: PayoutPlan): string | null {
  const statuses = plan.lines.flatMap((line) => (line.payout ? [line.payout.status] : []))
  if (statuses.length === 0) return null
  const count = (wanted: PayoutStatus[]) => statuses.filter((s) => wanted.includes(s)).length
  const parts = [`${count(['paid'])} of ${statuses.length} paid`]
  const moving = count(['queued', 'sending', 'accepted'])
  if (moving > 0) parts.push(`${moving} on the way`)
  if (count(['failed']) > 0) parts.push(`${count(['failed'])} not paid`)
  if (count(['unknown']) > 0) parts.push(`${count(['unknown'])} to check`)
  return parts.join(' · ')
}

type WalletState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'known'; availableCents: number }

/**
 * The IntaSend balance, read through the owner-only payout-wallet function.
 * Advisory: offline or unreadable, the owner may still send, and IntaSend
 * refuses a payout the wallet cannot cover without moving money.
 */
function usePayoutWallet(): { wallet: WalletState; recheck: () => void } {
  const { gateway } = useAuth()
  const [wallet, setWallet] = useState<WalletState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setWallet({ kind: 'loading' })
    gateway
      .payoutWallet()
      .then((answer) => {
        if (cancelled) return
        if ('error' in answer) setWallet({ kind: 'unavailable', message: answer.error })
        else if (answer.provider === 'daraja') setWallet({ kind: 'hidden' })
        else setWallet({ kind: 'known', availableCents: answer.availableCents })
      })
      .catch(() => {
        if (!cancelled) setWallet({ kind: 'unavailable', message: 'no connection' })
      })
    return () => {
      cancelled = true
    }
  }, [gateway, attempt])

  const recheck = useCallback(() => setAttempt((n) => n + 1), [])
  return { wallet, recheck }
}

function WalletNotice({
  wallet,
  totalShillings,
  onRecheck,
}: {
  wallet: WalletState
  totalShillings: number
  onRecheck: () => void
}) {
  if (wallet.kind === 'hidden') return null
  if (wallet.kind === 'loading') {
    return <p className="client-empty">Checking the IntaSend wallet balance.</p>
  }
  const recheck = (
    <Button size="sm" variant="ghost" onClick={onRecheck}>
      Check again
    </Button>
  )
  if (wallet.kind === 'unavailable') {
    return (
      <div className="rsk-stack">
        <p className="client-empty">
          {`Wallet balance not available (${wallet.message}). You can still send: a payment the wallet cannot cover is refused without moving any money.`}
        </p>
        <div>{recheck}</div>
      </div>
    )
  }

  const short = walletShortfall(totalShillings, wallet.availableCents)
  const balance = `IntaSend wallet: ${formatKes(wallet.availableCents)}. This run: ${shillings(totalShillings)}.`
  if (short > 0) {
    return (
      <div className="rsk-stack">
        <p className="auth-error" role="alert">
          {`${balance} The wallet is short by ${shillings(short)}. Top it up on the IntaSend dashboard, then check again.`}
        </p>
        <div>{recheck}</div>
      </div>
    )
  }
  return (
    <p className="client-empty">
      {`${balance} IntaSend's fees come out of the wallet on top of the total.`}
    </p>
  )
}

/**
 * Paying a run's salaries, by M-Pesa or bank transfer: a centre modal, because
 * it is one deliberate act. It lists who will be paid and how much, who will
 * not and why (with a way to fix missing details), shows whether the wallet
 * covers the run, and asks the owner to type the total, so the money that
 * leaves is the sum they read. After sending it stays open and follows each
 * payment until it is confirmed. Queuing is local; the server sends and
 * settles each payout.
 */
export function PayMpesaDialog({
  runId,
  periodLabel,
  refreshKey,
  onClose,
  onRequested,
  onFixEmployee,
}: {
  runId: string
  periodLabel: string
  /** Changes when an employee record changes, so the plan is read again. */
  refreshKey: number
  onClose: () => void
  onRequested: () => void
  /** Opens the employee's record over this dialog to fix missing details. */
  onFixEmployee: (employeeId: string) => void
}) {
  const { db, notifyLocalWrite, lastSyncedAt, syncNow } = useSync()
  const identity = useIdentity()
  const { showToast } = useToast()
  const { wallet, recheck } = usePayoutWallet()
  const repo = useMemo(
    () =>
      db
        ? new MpesaPayoutsRepository(db, identity.role, {
            userId: identity.userId,
            onLocalWrite: notifyLocalWrite,
          })
        : null,
    [db, identity.role, identity.userId, notifyLocalWrite],
  )

  const [plan, setPlan] = useState<PayoutPlan | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [sentAt, setSentAt] = useState(0)

  // Re-read after each sync (when the provider's answers come back), after
  // sending, and after an employee record is fixed.
  useEffect(() => {
    if (!repo) return
    let cancelled = false
    repo
      .plan(runId)
      .then((next) => {
        if (!cancelled) setPlan(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not read the run.')
      })
    return () => {
      cancelled = true
    }
  }, [repo, runId, lastSyncedAt, refreshKey, sentAt])

  const isInFlight = plan !== null && hasPayoutsInFlight(plan)
  useEffect(() => {
    if (!isInFlight) return
    const timer = setInterval(() => void syncNow(), POLL_MS)
    return () => clearInterval(timer)
  }, [isInFlight, syncNow])

  async function send() {
    if (!repo) return
    setError(null)
    setIsSending(true)
    try {
      const count = await repo.request(runId, typed, newId)
      showToast({
        tone: 'success',
        title: 'Salaries sent for payment',
        description: `${count} payment${count === 1 ? '' : 's'} queued. Each payslip is marked paid when its payment is confirmed.`,
      })
      setTyped('')
      setSentAt(Date.now())
      onRequested()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not queue the payments.')
    } finally {
      setIsSending(false)
    }
  }

  const total = plan?.totalShillings ?? 0
  const remainder = plan?.payable.reduce((sum, line) => sum + line.remainderCents, 0) ?? 0
  const hasPayable = plan !== null && plan.payable.length > 0
  const isShort =
    wallet.kind === 'known' && walletShortfall(total, wallet.availableCents) > 0 && hasPayable
  const progress = plan ? progressSummary(plan) : null

  return (
    <Modal
      isOpen
      size="lg"
      onClose={onClose}
      title="Pay salaries"
      description={periodLabel}
      footer={
        hasPayable ? (
          <>
            <Button onClick={onClose}>{progress ? 'Close' : 'Cancel'}</Button>
            <Button
              variant="primary"
              leadingIcon={<Send size={15} aria-hidden="true" />}
              isLoading={isSending}
              disabled={isShort}
              onClick={() => void send()}
            >
              {`Send ${shillings(total)}`}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="rsk-stack">
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        {progress ? (
          <p className="client-empty" aria-live="polite">
            {isInFlight ? `${progress}. Updating every 15 seconds.` : `${progress}.`}
          </p>
        ) : null}

        {!plan ? (
          <p className="client-empty">Reading the run.</p>
        ) : (
          <ul className="payout-list">
            {plan.lines.map((line) => (
              <li key={line.itemId} className="payout-list__item">
                <div>
                  <p className="payout-list__name">{line.employeeName}</p>
                  <p className="payout-list__meta">{lineDetail(line)}</p>
                </div>
                <div className="payout-list__right">
                  {line.needsDetails && line.employeeId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onFixEmployee(line.employeeId!)}
                      aria-label={`Fix payment details for ${line.employeeName}`}
                    >
                      Fix details
                    </Button>
                  ) : null}
                  <span className="payout-list__amount">{shillings(line.amountShillings)}</span>
                  {line.payout ? (
                    <StatusChip tone={STATUS[line.payout.status].tone}>
                      {STATUS[line.payout.status].label}
                    </StatusChip>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasPayable ? (
          <>
            <WalletNotice wallet={wallet} totalShillings={total} onRecheck={recheck} />
            <p className="client-empty">
              {`${plan.payable.length} of ${plan.lines.length} payslips will be paid now, ${shillings(total)} in total.`}
              {remainder > 0
                ? ` ${formatKes(remainder)} in cents is not sent and stays owed; settle it in cash.`
                : ''}
            </p>
            <Field
              label="Type the total to confirm"
              hint={`Enter ${total.toLocaleString('en-KE')} exactly. Money sent cannot be recalled.`}
            >
              <Input
                inputMode="numeric"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </>
        ) : plan && !progress ? (
          <p className="client-empty">
            No one in this run can be paid out right now. The reason is shown against each name.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
