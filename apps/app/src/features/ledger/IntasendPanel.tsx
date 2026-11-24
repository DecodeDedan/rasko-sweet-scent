'use client'

import { RefreshCw, Scale } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Button, Card, EmptyState, StatusChip, Table, formatDate, formatMoney } from '@rasko/ui'

import { useAuth } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import type { LedgerRepository, WalletReconciliation } from './ledgerRepository.js'
import type { ReconciledLine } from './reconcile.js'

const MATCH_LABEL: Record<ReconciledLine['match']['kind'], string> = {
  matched: 'In the books',
  cancelled: 'Failed payout, refunded',
  before_opening: 'In the opening balance',
  not_in_books: 'Not in the books',
}
const MATCH_TONE = {
  matched: 'success',
  cancelled: 'muted',
  before_opening: 'muted',
  not_in_books: 'warning',
} as const

interface IntasendPanelProps {
  repo: LedgerRepository
}

/** IntaSend's own statement against the books' IntaSend wallet account. */
export function IntasendPanel({ repo }: IntasendPanelProps) {
  const { gateway } = useAuth()
  const { syncNow } = useSync()
  const [result, setResult] = useState<WalletReconciliation | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const ticket = ++latestLoad.current
    try {
      const next = await repo.walletReconciliation()
      if (ticket !== latestLoad.current) return
      setResult(next)
      setError(null)
    } catch (cause) {
      if (ticket === latestLoad.current) {
        setError(cause instanceof Error ? cause.message : 'Could not reconcile the wallet.')
      }
    }
  }, [repo])
  useSyncedEffect(load)

  async function refresh() {
    setIsRefreshing(true)
    try {
      const answer = await gateway.syncIntasendStatement()
      if (answer.error) {
        setError(answer.error)
        return
      }
      await syncNow()
      await load()
    } finally {
      setIsRefreshing(false)
    }
  }

  if (result === undefined && !error) return <p className="rsk-metric__label">Reading the wallet</p>

  if (result === null) {
    return (
      <Card>
        <EmptyState
          icon={<Scale size={20} aria-hidden="true" />}
          title="No IntaSend wallet account"
          description="Add a KES account of kind Payout wallet under Accounts, with its opening balance, to reconcile it to IntaSend."
        />
      </Card>
    )
  }

  const difference = result?.differenceCents ?? null
  const unexplained = result?.lines.filter((line) => line.match.kind === 'not_in_books') ?? []
  // IntaSend's balance at the account's opening date: what the opening balance should be.
  const openingAtIntasend =
    result?.lines.filter((line) => line.match.kind === 'before_opening').at(-1)
      ?.running_balance_cents ?? 0

  return (
    <div className="rsk-stack">
      <div className="rsk-row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="secondary"
          leadingIcon={<RefreshCw size={15} aria-hidden="true" />}
          onClick={() => void refresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Reading IntaSend' : 'Refresh from IntaSend'}
        </Button>
        <span className="rsk-metric__label">
          {result?.lastMovementAt
            ? `IntaSend's last movement: ${formatDate(result.lastMovementAt.slice(0, 10))}. The server also reads IntaSend every 15 minutes.`
            : 'Nothing has been read from IntaSend yet.'}
        </span>
      </div>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="rsk-metrics">
          <Card>
            <p className="rsk-metric__label">IntaSend says</p>
            <p className="rsk-metric__value rsk-numeric">
              {result.intasendBalanceCents === null
                ? 'Not read yet'
                : formatMoney(result.intasendBalanceCents, 'KES')}
            </p>
          </Card>
          <Card>
            <p className="rsk-metric__label">The books say ({result.account.name})</p>
            <p className="rsk-metric__value rsk-numeric">
              {formatMoney(result.bookBalanceCents, 'KES')}
            </p>
          </Card>
          <Card>
            <p className="rsk-metric__label">Difference</p>
            <p className="rsk-metric__value rsk-numeric">
              {difference === null ? '' : formatMoney(difference, 'KES')}
            </p>
            {difference !== null ? (
              <StatusChip tone={difference === 0 ? 'success' : 'warning'}>
                {difference === 0 ? 'Reconciled' : 'Does not agree'}
              </StatusChip>
            ) : null}
          </Card>
        </div>
      ) : null}

      {result && difference !== null && difference !== 0 ? (
        <Card>
          <p>
            {unexplained.length > 0
              ? `${unexplained.length} IntaSend ${unexplained.length === 1 ? 'movement is' : 'movements are'} not in the books. Record each one (a top-up is a Transfer into the wallet) and the difference closes.`
              : `Every IntaSend movement since ${formatDate(result.account.opening_date)} is in the books, so the difference is in the opening balance (IntaSend held ${formatMoney(openingAtIntasend, 'KES')} then) or in a book entry IntaSend never saw.`}
            {result.notAtIntasend.length > 0
              ? ` ${result.notAtIntasend.length} book ${result.notAtIntasend.length === 1 ? 'entry has' : 'entries have'} no IntaSend movement.`
              : ''}
          </p>
        </Card>
      ) : null}

      <Card isFlush>
        <Table
          rows={result?.lines ?? []}
          getRowKey={(line) => line.transaction_id}
          caption="IntaSend statement"
          empty={
            <EmptyState
              icon={<Scale size={20} aria-hidden="true" />}
              title="No IntaSend movements"
              description="Deposits, salary payouts and IntaSend's charges appear here once the statement is read."
            />
          }
          columns={[
            {
              key: 'date',
              header: 'Date',
              render: (line) => formatDate(line.day),
            },
            {
              key: 'what',
              header: 'IntaSend',
              render: (line) => (
                <>
                  <span>{line.narrative ?? line.trans_type}</span>
                  <span className="rsk-metric__label">{line.transaction_id}</span>
                </>
              ),
            },
            {
              key: 'match',
              header: 'Books',
              render: (line) => (
                <>
                  <StatusChip tone={MATCH_TONE[line.match.kind]}>
                    {MATCH_LABEL[line.match.kind]}
                  </StatusChip>
                  {line.match.kind === 'matched' ? (
                    <span className="rsk-metric__label">{line.match.book.label}</span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'in',
              header: 'In',
              isNumeric: true,
              render: (line) => (line.value_cents > 0 ? formatMoney(line.value_cents, 'KES') : ''),
            },
            {
              key: 'out',
              header: 'Out',
              isNumeric: true,
              render: (line) => (line.value_cents < 0 ? formatMoney(-line.value_cents, 'KES') : ''),
            },
            {
              key: 'balance',
              header: 'Balance',
              isNumeric: true,
              render: (line) => formatMoney(line.running_balance_cents, 'KES'),
            },
          ]}
        />
      </Card>
    </div>
  )
}
