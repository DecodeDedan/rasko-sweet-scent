import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'

/**
 * Statement of account for one client over a period.
 *
 * Same arithmetic as the client balance (`clientsRepository.moneySelect`) and
 * the server's `client_balances` view: only issued invoices are owed,
 * payments reduce the balance, reversals add it back. The statement just
 * spreads that sum over time, so its closing balance at today equals the
 * client's outstanding balance. One statement per invoice currency, because
 * shillings are never added to dollars.
 */

export class StatementRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatementRuleError'
  }
}

export type StatementLineKind = 'invoice' | 'payment' | 'reversal'

export interface StatementLine {
  id: string
  kind: StatementLineKind
  date: string
  reference: string
  description: string
  debit_cents: number
  credit_cents: number
  balance_cents: number
}

/** What the closing balance is made of, by how far past due each invoice is. */
export interface StatementAging {
  current_cents: number
  days_1_30_cents: number
  days_31_60_cents: number
  days_61_90_cents: number
  days_over_90_cents: number
}

export interface Statement {
  currency: string
  opening_cents: number
  total_debit_cents: number
  total_credit_cents: number
  closing_cents: number
  lines: StatementLine[]
  aging: StatementAging
}

export interface StatementClient {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  kra_pin: string | null
}

export interface StatementSet {
  client: StatementClient
  from: string
  to: string
  statements: Statement[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

const ISSUED = "i.status = 'issued' AND i.deleted_at IS NULL"

/** Every movement on the client's account, dated in Nairobi time. */
const MOVEMENTS_SQL = `
  SELECT 'invoice:' || i.id AS id, 'invoice' AS kind,
         COALESCE(i.issue_date, date(i.created_at, '+3 hours')) AS date,
         COALESCE(i.invoice_number, 'Pending number') AS reference,
         'Invoice' AS description,
         i.total_cents AS debit, 0 AS credit, COALESCE(i.currency, 'KES') AS currency,
         i.created_at AS sort_at
  FROM invoices i
  WHERE ${ISSUED} AND i.client_id = ?

  UNION ALL
  SELECT 'payment:' || p.id, 'payment', date(p.paid_at, '+3 hours'),
         COALESCE(p.reference, ''),
         'Payment, ' || COALESCE(i.invoice_number, 'invoice'),
         0, p.amount_cents, COALESCE(i.currency, 'KES'), p.paid_at
  FROM payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE ${ISSUED} AND i.client_id = ?

  UNION ALL
  SELECT 'reversal:' || r.id, 'reversal', date(r.reversed_at, '+3 hours'),
         COALESCE(p.reference, ''),
         'Payment reversed: ' || COALESCE(r.reason, ''),
         r.amount_cents, 0, COALESCE(i.currency, 'KES'), r.reversed_at
  FROM reversals r
  JOIN payments p ON p.id = r.payment_id
  JOIN invoices i ON i.id = p.invoice_id
  WHERE ${ISSUED} AND i.client_id = ?
`

export function canSeeStatements(role: Role): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant'
}

function emptyAging(): StatementAging {
  return {
    current_cents: 0,
    days_1_30_cents: 0,
    days_31_60_cents: 0,
    days_61_90_cents: 0,
    days_over_90_cents: 0,
  }
}

function addToBucket(aging: StatementAging, daysOverdue: number, cents: number): StatementAging {
  if (daysOverdue <= 0) return { ...aging, current_cents: aging.current_cents + cents }
  if (daysOverdue <= 30) return { ...aging, days_1_30_cents: aging.days_1_30_cents + cents }
  if (daysOverdue <= 60) return { ...aging, days_31_60_cents: aging.days_31_60_cents + cents }
  if (daysOverdue <= 90) return { ...aging, days_61_90_cents: aging.days_61_90_cents + cents }
  return { ...aging, days_over_90_cents: aging.days_over_90_cents + cents }
}

export class StatementRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
  ) {}

  async clients(): Promise<Array<{ id: string; name: string }>> {
    return this.db.select<{ id: string; name: string }>(
      `SELECT id, name FROM clients WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    )
  }

  async statement(clientId: string, from: string, to: string): Promise<StatementSet> {
    if (!canSeeStatements(this.role)) {
      throw new StatementRuleError('This role cannot produce statements of account.')
    }
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
      throw new StatementRuleError('Choose a start date on or before the end date.')
    }
    const [client] = await this.db.select<StatementClient>(
      `SELECT id, name, phone, email, address, kra_pin FROM clients WHERE id = ?`,
      [clientId],
    )
    if (!client) throw new StatementRuleError('Client not found on this device.')

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM (${MOVEMENTS_SQL}) WHERE date <= ? ORDER BY date, sort_at, id`,
      [clientId, clientId, clientId, to],
    )
    const currencies = [...new Set(rows.map((row) => String(row['currency'])))].sort()
    const aging = await this.agingAt(clientId, to)

    const statements = currencies.map((currency) => {
      const own = rows.filter((row) => String(row['currency']) === currency)
      const before = own.filter((row) => String(row['date']) < from)
      const opening = before.reduce(
        (sum, row) => sum + Number(row['debit']) - Number(row['credit']),
        0,
      )

      let balance = opening
      const lines = own
        .filter((row) => String(row['date']) >= from)
        .map((row): StatementLine => {
          const debit = Number(row['debit'])
          const credit = Number(row['credit'])
          balance += debit - credit
          return {
            id: String(row['id']),
            kind: row['kind'] as StatementLineKind,
            date: String(row['date']),
            reference: String(row['reference']),
            description: String(row['description']),
            debit_cents: debit,
            credit_cents: credit,
            balance_cents: balance,
          }
        })

      return {
        currency,
        opening_cents: opening,
        total_debit_cents: lines.reduce((sum, line) => sum + line.debit_cents, 0),
        total_credit_cents: lines.reduce((sum, line) => sum + line.credit_cents, 0),
        closing_cents: balance,
        lines,
        aging: aging.get(currency) ?? emptyAging(),
      }
    })

    return { client, from, to, statements }
  }

  /** Each issued invoice's unpaid remainder at `asOf`, bucketed by days past due. */
  private async agingAt(clientId: string, asOf: string): Promise<Map<string, StatementAging>> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT COALESCE(i.currency, 'KES') AS currency,
              COALESCE(i.due_date, i.issue_date, date(i.created_at, '+3 hours')) AS due,
              i.total_cents
                - COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                            WHERE p.invoice_id = i.id AND date(p.paid_at, '+3 hours') <= ?), 0)
                + COALESCE((SELECT SUM(r.amount_cents) FROM reversals r
                            JOIN payments p ON p.id = r.payment_id
                            WHERE p.invoice_id = i.id AND date(r.reversed_at, '+3 hours') <= ?), 0)
                AS open_cents
       FROM invoices i
       WHERE ${ISSUED} AND i.client_id = ?
         AND COALESCE(i.issue_date, date(i.created_at, '+3 hours')) <= ?`,
      [asOf, asOf, clientId, asOf],
    )
    const result = new Map<string, StatementAging>()
    const asOfMs = Date.parse(`${asOf}T00:00:00Z`)
    for (const row of rows) {
      const open = Number(row['open_cents'])
      if (open === 0) continue
      // An overpaid invoice is a credit; it nets in the current bucket so the
      // buckets always add up to the closing balance.
      const currency = String(row['currency'])
      const dueMs = Date.parse(`${String(row['due'])}T00:00:00Z`)
      const days = Number.isNaN(dueMs) ? 0 : Math.floor((asOfMs - dueMs) / DAY_MS)
      result.set(
        currency,
        addToBucket(result.get(currency) ?? emptyAging(), open < 0 ? 0 : days, open),
      )
    }
    return result
  }
}
