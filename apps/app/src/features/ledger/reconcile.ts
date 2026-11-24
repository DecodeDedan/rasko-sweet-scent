/**
 * Bank reconciliation for the IntaSend wallet: IntaSend's own statement
 * (intasend_wallet_transactions, copied by the intasend-sync function) against
 * what the books say moved through the wallet.
 *
 * Pure: the repository loads the rows, this decides what matches. A statement
 * line is matched to one book line at most, and a book line to one statement
 * line at most, so two identical salaries on one day cannot both claim the
 * same debit.
 */

/** One line of IntaSend's wallet statement. `value_cents` is signed. */
export interface StatementLine {
  transaction_id: string
  trans_type: string
  value_cents: number
  running_balance_cents: number
  narrative: string | null
  day: string
  occurred_at: string
}

/**
 * Something the books say moved through the wallet, from the wallet's side:
 * a salary payout is its amount plus IntaSend's fee, negative; a top-up is
 * positive.
 */
export interface BookMovement {
  id: string
  day: string
  amount_cents: number
  label: string
}

export type StatementMatch =
  /** A book line accounts for it. */
  | { kind: 'matched'; book: BookMovement }
  /** A payout IntaSend debited and then credited back when it failed. Nets to zero. */
  | { kind: 'cancelled' }
  /** Dated before the account's opening date: the opening balance already holds it. */
  | { kind: 'before_opening' }
  /** Money moved at IntaSend that the books do not show. */
  | { kind: 'not_in_books' }

export interface ReconciledLine extends StatementLine {
  match: StatementMatch
}

export interface Reconciliation {
  lines: ReconciledLine[]
  /** Book lines IntaSend's statement does not show (yet, or at all). */
  notAtIntasend: BookMovement[]
}

/** How far apart the book date and IntaSend's date may be and still match. */
const MATCH_WINDOW_DAYS = 2

const DAY_MS = 24 * 60 * 60 * 1000
const dayGap = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS

/** "Payout: #GR870MY" and "Credit for failed payout: #GR870MY" name the same payout. */
const payoutReference = (narrative: string | null): string | null =>
  /#([A-Z0-9]+)/i.exec(narrative ?? '')?.[1]?.toUpperCase() ?? null
const isFailedPayoutCredit = (line: StatementLine): boolean =>
  line.value_cents > 0 && /failed payout/i.test(line.narrative ?? '')

function cancelledIds(statement: readonly StatementLine[]): Set<string> {
  const cancelled = new Set<string>()
  for (const credit of statement.filter(isFailedPayoutCredit)) {
    const reference = payoutReference(credit.narrative)
    const debit = statement.find(
      (line) =>
        !cancelled.has(line.transaction_id) &&
        line.value_cents === -credit.value_cents &&
        !isFailedPayoutCredit(line) &&
        reference !== null &&
        payoutReference(line.narrative) === reference,
    )
    if (debit) {
      cancelled.add(debit.transaction_id)
      cancelled.add(credit.transaction_id)
    }
  }
  return cancelled
}

/**
 * The account's balance counts only what happened on or after its opening
 * date, so the statement does too: earlier lines are the opening balance.
 */
export function reconcileWallet(
  statement: readonly StatementLine[],
  bookMovements: readonly BookMovement[],
  openingDate: string,
): Reconciliation {
  const ordered = [...statement].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  const book = bookMovements.filter((movement) => movement.day >= openingDate)
  const cancelled = cancelledIds(ordered)
  const used = new Set<string>()

  const lines = ordered.map((line): ReconciledLine => {
    if (line.day < openingDate) return { ...line, match: { kind: 'before_opening' } }
    if (cancelled.has(line.transaction_id)) return { ...line, match: { kind: 'cancelled' } }
    const candidate = book
      .filter(
        (movement) =>
          !used.has(movement.id) &&
          movement.amount_cents === line.value_cents &&
          dayGap(movement.day, line.day) <= MATCH_WINDOW_DAYS,
      )
      .sort((a, b) => dayGap(a.day, line.day) - dayGap(b.day, line.day))[0]
    if (!candidate) return { ...line, match: { kind: 'not_in_books' } }
    used.add(candidate.id)
    return { ...line, match: { kind: 'matched', book: candidate } }
  })

  return { lines, notAtIntasend: book.filter((movement) => !used.has(movement.id)) }
}
