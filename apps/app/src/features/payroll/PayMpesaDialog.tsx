'use client'

import { Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, Field, Input, Modal, StatusChip, formatKes, useToast } from '@rasko/ui'
import type { StatusTone } from '@rasko/ui'

import { useIdentity } from '../../auth/AuthProvider.js'
import { newId } from '../../data/ids.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { MpesaPayoutsRepository } from './mpesaPayouts.js'
import type { PayoutLine, PayoutPlan, PayoutStatus } from './mpesaPayouts.js'

const STATUS: Record<PayoutStatus, { label: string; tone: StatusTone }> = {
  queued: { label: 'Waiting to send', tone: 'neutral' },
  sending: { label: 'Sending', tone: 'neutral' },
  accepted: { label: 'Awaiting confirmation', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Not paid', tone: 'danger' },
  unknown: { label: 'Check statement', tone: 'warning' },
}

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

/**
 * Paying a run's salaries, by M-Pesa or bank transfer: a centre modal, because
 * it is one deliberate act. It lists who will be paid and how much, who will not and
 * why, and asks the owner to type the total, so the money that leaves is the
 * sum they read. Queuing is local; the server sends and settles each payout.
 */
export function PayMpesaDialog({
  runId,
  periodLabel,
  onClose,
  onRequested,
}: {
  runId: string
  periodLabel: string
  onClose: () => void
  onRequested: () => void
}) {
  const { db, notifyLocalWrite, lastSyncedAt } = useSync()
  const identity = useIdentity()
  const { showToast } = useToast()
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

  // Re-read after each sync: that is when the provider's answers come back.
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
  }, [repo, runId, lastSyncedAt])

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
      onRequested()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not queue the payments.')
    } finally {
      setIsSending(false)
    }
  }

  const total = plan?.totalShillings ?? 0
  const remainder = plan?.payable.reduce((sum, line) => sum + line.remainderCents, 0) ?? 0

  return (
    <Modal
      isOpen
      size="lg"
      onClose={onClose}
      title="Pay salaries"
      description={periodLabel}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            leadingIcon={<Send size={15} aria-hidden="true" />}
            isLoading={isSending}
            disabled={!plan || plan.payable.length === 0}
            onClick={() => void send()}
          >
            {`Send ${shillings(total)}`}
          </Button>
        </>
      }
    >
      <div className="rsk-stack">
        {error ? (
          <p className="auth-error" role="alert">
            {error}
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

        {plan && plan.payable.length > 0 ? (
          <>
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
        ) : plan ? (
          <p className="client-empty">
            No one in this run can be paid out right now. The reason is shown against each name.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
