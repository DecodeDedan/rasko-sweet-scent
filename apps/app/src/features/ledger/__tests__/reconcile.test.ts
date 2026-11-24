import { describe, expect, it } from 'vitest'

import { reconcileWallet } from '../reconcile.js'
import type { StatementLine } from '../reconcile.js'

// The sandbox wallet statement as IntaSend reported it on 2026-11-24.
const line = (
  transaction_id: string,
  value_cents: number,
  running_balance_cents: number,
  narrative: string,
  occurred_at: string,
  trans_type = 'PAYOUT',
): StatementLine => ({
  transaction_id,
  trans_type,
  value_cents,
  running_balance_cents,
  narrative,
  occurred_at,
  day: occurred_at.slice(0, 10),
})
const STATEMENT = [
  line('T1', 100_000, 100_000, 'Direct Bill', '2026-11-24T20:43:25Z', 'SALE'),
  line('T2', -63_500, 36_500, 'Payout: #GR870MY', '2026-11-24T20:53:13Z'),
  line('T3', 63_500, 100_000, 'Credit for failed payout: #GR870MY', '2026-11-24T20:54:00Z'),
  line('T4', -63_500, 36_500, 'Payout: #LQPLOOR', '2026-11-24T20:57:03Z'),
]

const OPENED = '2026-11-01'

describe('reconcileWallet', () => {
  it('matches a paid salary to its debit, amount plus fee, and nets a failed payout to zero', () => {
    const salary = { id: 'po-1', day: '2026-11-24', amount_cents: -63_500, label: 'Salary' }
    const topUp = { id: 'le-1', day: '2026-11-24', amount_cents: 100_000, label: 'Top-up' }
    const result = reconcileWallet(STATEMENT, [salary, topUp], OPENED)

    expect(result.lines.map((l) => [l.transaction_id, l.match.kind])).toEqual([
      ['T1', 'matched'],
      ['T2', 'cancelled'],
      ['T3', 'cancelled'],
      ['T4', 'matched'],
    ])
    expect(result.lines[3]?.match).toEqual({ kind: 'matched', book: salary })
    expect(result.notAtIntasend).toEqual([])
  })

  it('reports money IntaSend moved that the books do not show, and the reverse', () => {
    const unrelated = { id: 'le-2', day: '2026-11-24', amount_cents: -5_000, label: 'Withdrawal' }
    const result = reconcileWallet(STATEMENT, [unrelated], OPENED)

    expect(
      result.lines.filter((l) => l.match.kind === 'not_in_books').map((l) => l.transaction_id),
    ).toEqual(['T1', 'T4'])
    expect(result.notAtIntasend).toEqual([unrelated])
  })

  it('lets one book line settle one statement line only, and only within two days', () => {
    const twin = [
      line('A', -63_500, 0, 'Payout: #A', '2026-11-24T08:00:00Z'),
      line('B', -63_500, 0, 'Payout: #B', '2026-11-24T09:00:00Z'),
    ]
    const one = { id: 'po-1', day: '2026-11-24', amount_cents: -63_500, label: 'Salary' }
    expect(reconcileWallet(twin, [one], OPENED).lines.map((l) => l.match.kind)).toEqual([
      'matched',
      'not_in_books',
    ])

    const late = { id: 'po-2', day: '2026-11-27', amount_cents: -63_500, label: 'Salary' }
    expect(reconcileWallet(twin.slice(0, 1), [late], OPENED).lines[0]?.match.kind).toBe(
      'not_in_books',
    )
  })

  it('never cancels a failed-payout credit against a different payout', () => {
    const result = reconcileWallet(
      [
        line('X', -63_500, 0, 'Payout: #AAA', '2026-11-24T08:00:00Z'),
        line('Y', 63_500, 63_500, 'Credit for failed payout: #BBB', '2026-11-24T08:01:00Z'),
      ],
      [],
      OPENED,
    )
    expect(result.lines.map((l) => l.match.kind)).toEqual(['not_in_books', 'not_in_books'])
  })

  it('counts statement lines before the opening date as the opening balance, and ignores earlier book lines', () => {
    const salary = { id: 'po-1', day: '2026-11-24', amount_cents: -63_500, label: 'Salary' }
    const result = reconcileWallet(STATEMENT, [salary], '2026-11-25')

    expect(result.lines.every((l) => l.match.kind === 'before_opening')).toBe(true)
    expect(result.notAtIntasend).toEqual([])
  })
})
