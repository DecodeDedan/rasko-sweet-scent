import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import type {
  Client,
  ClientDetail,
  ClientInvoiceRow,
  ClientOrderRow,
  ClientPaymentRow,
  ClientQuery,
  ClientSummary,
} from './types.js'

/**
 * Clients data access (FR-3.1 – FR-3.6).
 *
 * Reads and writes the device database only; the sync engine carries writes
 * upward (NFR-S1). Nothing here touches the network.
 *
 * ## Why the balance aggregate is reimplemented here
 *
 * Outstanding balance and lifetime value come from the `client_balances` and
 * `invoice_balances` views on the server. Views do not exist in the local
 * mirror, and FR-3.3 has to work offline, so the same arithmetic is expressed
 * once more in SQLite.
 *
 * That is a genuine duplication and it can drift. `__tests__/balances.test.ts`
 * pins it: the expected figures in that file were read out of the Postgres views
 * against the seeded data, so if either definition changes, the test fails.
 */

/**
 * Reduces a typed phone number to its national significant digits.
 *
 * Numbers are stored E.164 (+254712004518) but nobody types them that way: a
 * Kenyan user writes 0712 004 518, and the leading zero is a trunk prefix, not
 * part of the number. Stripping it — and a 254 country code if present — makes
 * all three spellings find the same client.
 */
export function phoneSearchDigits(input: string): string {
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('254')) digits = digits.slice(3)
  return digits.replace(/^0+/, '')
}

/** Only issued invoices count toward a balance — drafts are not owed, voids are cancelled. */
const ISSUED = "i.status = 'issued' AND i.deleted_at IS NULL"

const SUMMARY_SELECT = `
  SELECT
    c.id, c.name, c.client_type, c.phone, c.email, c.kra_pin, c.address,
    c.credit_terms_days, c.notes, c.created_by, c.created_at, c.updated_at, c.deleted_at,
    COALESCE(inv.invoiced_cents, 0)                                   AS lifetime_cents,
    COALESCE(inv.invoiced_cents, 0)
      - COALESCE(pay.paid_cents, 0)
      + COALESCE(rev.reversed_cents, 0)                               AS outstanding_cents,
    COALESCE(inv.invoice_count, 0)                                    AS invoice_count,
    COALESCE(ord.order_count, 0)                                      AS order_count,
    ord.last_activity_at                                              AS last_activity_at
  FROM clients c
  LEFT JOIN (
    SELECT i.client_id, SUM(i.total_cents) AS invoiced_cents, COUNT(*) AS invoice_count
    FROM invoices i WHERE ${ISSUED} GROUP BY i.client_id
  ) inv ON inv.client_id = c.id
  LEFT JOIN (
    SELECT i.client_id, SUM(p.amount_cents) AS paid_cents
    FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE ${ISSUED} GROUP BY i.client_id
  ) pay ON pay.client_id = c.id
  LEFT JOIN (
    -- Reversals add back: a reversed payment never happened (FR-5.5).
    SELECT i.client_id, SUM(r.amount_cents) AS reversed_cents
    FROM reversals r
    JOIN payments p ON p.id = r.payment_id
    JOIN invoices i ON i.id = p.invoice_id
    WHERE ${ISSUED} GROUP BY i.client_id
  ) rev ON rev.client_id = c.id
  LEFT JOIN (
    SELECT o.client_id, COUNT(*) AS order_count, MAX(o.created_at) AS last_activity_at
    FROM orders o WHERE o.deleted_at IS NULL GROUP BY o.client_id
  ) ord ON ord.client_id = c.id
`

interface SummaryRow {
  id: string
  name: string
  client_type: string
  phone: string | null
  email: string | null
  kra_pin: string | null
  address: string | null
  credit_terms_days: number
  notes: string | null
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
  lifetime_cents: number
  outstanding_cents: number
  invoice_count: number
  order_count: number
  last_activity_at: string | null
}

function toSummary(row: SummaryRow): ClientSummary {
  return {
    id: row.id,
    name: row.name,
    client_type: row.client_type as ClientSummary['client_type'],
    phone: row.phone,
    email: row.email,
    kra_pin: row.kra_pin,
    address: row.address,
    credit_terms_days: Number(row.credit_terms_days ?? 0),
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    lifetimeCents: Number(row.lifetime_cents ?? 0),
    outstandingCents: Number(row.outstanding_cents ?? 0),
    invoiceCount: Number(row.invoice_count ?? 0),
    orderCount: Number(row.order_count ?? 0),
    lastActivityAt: row.last_activity_at,
  }
}

export class ClientNotDeletableError extends Error {
  constructor(readonly outstandingCents: number) {
    super('This client still has unpaid invoices.')
    this.name = 'ClientNotDeletableError'
  }
}

export interface ClientsScope {
  role: Role
  userId: string | null
}

export class ClientsRepository {
  private readonly repo: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly scope: ClientsScope,
    context: WriteContext,
  ) {
    this.repo = new Repository(db, 'clients', context)
  }

  /**
   * FR-3.4: a sales user sees only the clients they created.
   *
   * Their local mirror already contains only those rows, because RLS filtered
   * what the server sent. Repeating the rule here keeps the screen honest if a
   * device ever holds rows from a wider role — the UI must never show something
   * the next sync would take away.
   */
  private scopeClause(params: unknown[]): string {
    if (this.scope.role === 'sales') {
      params.push(this.scope.userId ?? '')
      return ' AND c.created_by = ?'
    }
    return ''
  }

  async list(query: ClientQuery = {}): Promise<ClientSummary[]> {
    const params: unknown[] = []
    let where = ' WHERE c.deleted_at IS NULL'

    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`
      // Phone is stored E.164 (+254...). Stripping non-digits from both sides
      // means "0712 004 518" and "712004518" both find +254712004518.
      const digits = phoneSearchDigits(query.search)
      where += ' AND (LOWER(c.name) LIKE ?'
      params.push(term)
      if (digits.length >= 3) {
        where += " OR REPLACE(REPLACE(c.phone, ' ', ''), '+', '') LIKE ?"
        params.push(`%${digits}%`)
      }
      where += ')'
    }

    if (query.type && query.type !== 'all') {
      where += ' AND c.client_type = ?'
      params.push(query.type)
    }

    where += this.scopeClause(params)

    const order =
      query.sort === 'outstanding'
        ? ' ORDER BY outstanding_cents DESC, c.name COLLATE NOCASE'
        : query.sort === 'recent'
          ? ' ORDER BY COALESCE(last_activity_at, c.created_at) DESC, c.name COLLATE NOCASE'
          : ' ORDER BY c.name COLLATE NOCASE'

    const rows = await this.db.select<SummaryRow>(SUMMARY_SELECT + where + order, params)
    return rows.map(toSummary)
  }

  async findSummary(
    id: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<ClientSummary | null> {
    const params: unknown[] = [id]
    const where =
      ' WHERE c.id = ?' +
      (options.includeDeleted ? '' : ' AND c.deleted_at IS NULL') +
      this.scopeClause(params)
    const rows = await this.db.select<SummaryRow>(SUMMARY_SELECT + where, params)
    const row = rows[0]
    return row ? toSummary(row) : null
  }

  /** FR-3.3: contact details, order and invoice history, and recent payments. */
  async detail(id: string): Promise<ClientDetail | null> {
    const client = await this.findSummary(id)
    if (!client) return null

    const orders = await this.db.select<ClientOrderRow>(
      `SELECT id, order_number, status, delivery_at, total_cents
       FROM orders WHERE client_id = ? AND deleted_at IS NULL
       ORDER BY COALESCE(delivery_at, created_at) DESC`,
      [id],
    )

    const invoices = await this.db.select<ClientInvoiceRow>(
      `SELECT i.id, i.invoice_number, i.status, i.issue_date, i.due_date, i.total_cents,
              COALESCE(p.paid, 0) - COALESCE(r.reversed, 0) AS paid_cents,
              i.total_cents - COALESCE(p.paid, 0) + COALESCE(r.reversed, 0) AS balance_cents
       FROM invoices i
       LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid FROM payments GROUP BY invoice_id) p
         ON p.invoice_id = i.id
       LEFT JOIN (SELECT p2.invoice_id, SUM(r2.amount_cents) AS reversed
                  FROM reversals r2 JOIN payments p2 ON p2.id = r2.payment_id
                  GROUP BY p2.invoice_id) r ON r.invoice_id = i.id
       WHERE i.client_id = ? AND i.deleted_at IS NULL
       ORDER BY i.issue_date DESC`,
      [id],
    )

    const payments = await this.db.select<ClientPaymentRow>(
      `SELECT p.id, i.invoice_number, p.amount_cents, p.method, p.paid_at, p.reference
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE i.client_id = ?
       ORDER BY p.paid_at DESC
       LIMIT 10`,
      [id],
    )

    return { client, orders, invoices, payments }
  }

  async create(values: Omit<Client, 'created_at' | 'updated_at' | 'deleted_at' | 'created_by'>) {
    return this.repo.insert(values as never)
  }

  async update(id: string, patch: Partial<Client>) {
    return this.repo.update(id, patch as never)
  }

  /**
   * FR-3.5: refuse while any issued invoice still has a balance.
   *
   * Checked here so the user gets an immediate, specific answer offline. It is
   * NOT the enforcement — the `clients_guard_soft_delete` trigger refuses the
   * write server-side even if this check is bypassed or the device's mirror is
   * stale (architecture.md §6.6). Deleting also writes an audit row, via the
   * `clients_audit_delete` trigger.
   */
  async softDelete(id: string): Promise<void> {
    const summary = await this.findSummary(id)
    if (!summary) throw new Error('Client not found on this device.')
    if (summary.outstandingCents > 0) {
      throw new ClientNotDeletableError(summary.outstandingCents)
    }
    await this.repo.softDelete(id)
  }
}
