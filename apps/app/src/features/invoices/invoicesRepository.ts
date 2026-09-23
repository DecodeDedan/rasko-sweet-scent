import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import { daysOverdue, deriveStatus } from './status.js'
import type {
  CompanySettings,
  InvoiceDetail,
  InvoiceQuery,
  InvoiceSummary,
  PaymentMethod,
} from './types.js'

/**
 * Invoices and payments (FR-5.1 – FR-5.8).
 *
 * Local database only. Every rule here is also enforced server-side: payments
 * have no UPDATE or DELETE policy for any role and a trigger that raises on
 * both, reversals are restricted to manager and owner, and invoice numbers are
 * allocated by `app.allocate_document_number` inside the transaction that
 * stores the row.
 */

export class InvoiceRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceRuleError'
  }
}

/**
 * FR-5.4: the balance is a sum over payments and reversals, never a stored
 * editable column. Two devices recording payments offline against the same
 * invoice therefore need no merge — the arithmetic simply includes both (T3).
 */
const SUMMARY_SELECT = `
  SELECT i.*,
         COALESCE(c.name, json_extract(i.client_snapshot, '$.name'), 'Walk-in') AS client_name,
         c.phone AS client_phone,
         c.email AS client_email,
         COALESCE(p.paid, 0)      AS paid_raw,
         COALESCE(r.reversed, 0)  AS reversed_raw
  FROM invoices i
  LEFT JOIN clients c ON c.id = i.client_id
  LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid FROM payments GROUP BY invoice_id) p
    ON p.invoice_id = i.id
  LEFT JOIN (
    SELECT p2.invoice_id, SUM(r2.amount_cents) AS reversed
    FROM reversals r2 JOIN payments p2 ON p2.id = r2.payment_id
    GROUP BY p2.invoice_id
  ) r ON r.invoice_id = i.id
`

function toSummary(row: Record<string, unknown>, today?: Date): InvoiceSummary {
  const total = Number(row['total_cents'] ?? 0)
  const paidRaw = Number(row['paid_raw'] ?? 0)
  const reversed = Number(row['reversed_raw'] ?? 0)
  const paid = paidRaw - reversed
  const balance = total - paid
  const stored = String(row['status'] ?? 'draft') as InvoiceSummary['status']
  const dueDate = String(row['due_date'] ?? '')

  return {
    ...(row as unknown as InvoiceSummary),
    status: stored,
    subtotal_cents: Number(row['subtotal_cents'] ?? 0),
    discount_cents: Number(row['discount_cents'] ?? 0),
    vat_rate_bp: Number(row['vat_rate_bp'] ?? 0),
    vat_cents: Number(row['vat_cents'] ?? 0),
    total_cents: total,
    clientName: String(row['client_name'] ?? 'Walk-in'),
    clientPhone: row['client_phone'] == null ? null : String(row['client_phone']),
    paidCents: paid,
    reversedCents: reversed,
    balanceCents: balance,
    derivedStatus: deriveStatus({
      stored,
      balanceCents: balance,
      paidCents: paid,
      dueDate,
      ...(today ? { today } : {}),
    }),
    daysOverdue: daysOverdue(dueDate, today ?? new Date()),
  }
}

export interface InvoicesScope {
  role: Role
  userId: string | null
}

export interface NewPaymentInput {
  id: string
  invoiceId: string
  amountCents: number
  method: PaymentMethod
  reference: string | null
  paidAt: string
  notes: string | null
}

export class InvoicesRepository {
  private readonly invoices: Repository<Record<string, unknown>>
  private readonly payments: Repository<Record<string, unknown>>
  private readonly reversals: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly scope: InvoicesScope,
    private readonly context: WriteContext,
    /** Injected so tests can pin "today" for the overdue arithmetic. */
    private readonly today?: Date,
  ) {
    this.invoices = new Repository(db, 'invoices', context)
    this.payments = new Repository(db, 'payments', context)
    this.reversals = new Repository(db, 'reversals', context)
  }

  private now(): string {
    return this.context.now?.() ?? new Date().toISOString()
  }

  /** PRD §3.1: a sales user sees only the invoices they raised. */
  private scopeClause(params: unknown[]): string {
    if (this.scope.role === 'sales') {
      params.push(this.scope.userId ?? '')
      return ' AND i.created_by = ?'
    }
    return ''
  }

  async list(query: InvoiceQuery = {}): Promise<InvoiceSummary[]> {
    const params: unknown[] = []
    let where = ' WHERE i.deleted_at IS NULL'

    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`
      where +=
        " AND (LOWER(COALESCE(i.invoice_number, '')) LIKE ? OR LOWER(COALESCE(c.name, '')) LIKE ?)"
      params.push(term, term)
    }
    if (query.view === 'draft') where += " AND i.status = 'draft'"
    if (query.view === 'outstanding' || query.view === 'overdue')
      where += " AND i.status = 'issued'"

    where += this.scopeClause(params)

    const rows = await this.db.select<Record<string, unknown>>(
      `${SUMMARY_SELECT}${where} ORDER BY i.issue_date DESC, i.invoice_number DESC`,
      params,
    )
    let summaries = rows.map((row) => toSummary(row, this.today))

    // Balance-dependent views filter after the aggregate, because the balance
    // is not a column to put in a WHERE clause.
    if (query.view === 'outstanding') summaries = summaries.filter((i) => i.balanceCents > 0)
    if (query.view === 'overdue') summaries = summaries.filter((i) => i.derivedStatus === 'overdue')

    return summaries
  }

  /** FR-5.8: overdue invoices with the contact details to chase them. */
  async overdue(): Promise<InvoiceSummary[]> {
    const list = await this.list({ view: 'overdue' })
    return list.sort((a, b) => b.daysOverdue - a.daysOverdue)
  }

  async findSummary(id: string): Promise<InvoiceSummary | null> {
    const params: unknown[] = [id]
    const where = ' WHERE i.id = ? AND i.deleted_at IS NULL' + this.scopeClause(params)
    const rows = await this.db.select<Record<string, unknown>>(SUMMARY_SELECT + where, params)
    const row = rows[0]
    return row ? toSummary(row, this.today) : null
  }

  async detail(id: string): Promise<InvoiceDetail | null> {
    const params: unknown[] = [id]
    const where = ' WHERE i.id = ? AND i.deleted_at IS NULL' + this.scopeClause(params)
    const rows = await this.db.select<Record<string, unknown>>(SUMMARY_SELECT + where, params)
    const row = rows[0]
    if (!row) return null

    const paymentRows = await this.db.select<Record<string, unknown>>(
      `SELECT p.*, COALESCE(r.reversed, 0) AS reversed_raw
       FROM payments p
       LEFT JOIN (SELECT payment_id, SUM(amount_cents) AS reversed FROM reversals GROUP BY payment_id) r
         ON r.payment_id = p.id
       WHERE p.invoice_id = ? ORDER BY p.paid_at DESC`,
      [id],
    )

    const reversalRows = await this.db.select<Record<string, unknown>>(
      `SELECT r.* FROM reversals r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.invoice_id = ? ORDER BY r.reversed_at DESC`,
      [id],
    )

    return {
      invoice: toSummary(row, this.today),
      payments: paymentRows.map((p) => ({
        id: String(p['id']),
        invoice_id: String(p['invoice_id']),
        amount_cents: Number(p['amount_cents'] ?? 0),
        method: String(p['method'] ?? 'cash') as PaymentMethod,
        reference: p['reference'] == null ? null : String(p['reference']),
        paid_at: String(p['paid_at'] ?? ''),
        received_by: p['received_by'] == null ? null : String(p['received_by']),
        notes: p['notes'] == null ? null : String(p['notes']),
        created_at: p['created_at'] == null ? null : String(p['created_at']),
        reversedCents: Number(p['reversed_raw'] ?? 0),
      })),
      reversals: reversalRows.map((r) => ({
        id: String(r['id']),
        payment_id: String(r['payment_id']),
        amount_cents: Number(r['amount_cents'] ?? 0),
        reason: String(r['reason'] ?? ''),
        reversed_at: String(r['reversed_at'] ?? ''),
        created_by: r['created_by'] == null ? null : String(r['created_by']),
      })),
      clientPhone: row['client_phone'] == null ? null : String(row['client_phone']),
      clientEmail: row['client_email'] == null ? null : String(row['client_email']),
    }
  }

  async companySettings(): Promise<CompanySettings | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      'SELECT * FROM company_settings LIMIT 1',
    )
    const row = rows[0]
    if (!row) return null
    return {
      company_name: String(row['company_name'] ?? 'Rasko Sweet Scent'),
      address: row['address'] == null ? null : String(row['address']),
      phone: row['phone'] == null ? null : String(row['phone']),
      email: row['email'] == null ? null : String(row['email']),
      kra_pin: row['kra_pin'] == null ? null : String(row['kra_pin']),
      mpesa_paybill: row['mpesa_paybill'] == null ? null : String(row['mpesa_paybill']),
      mpesa_till: row['mpesa_till'] == null ? null : String(row['mpesa_till']),
      bank_details:
        row['bank_details'] == null
          ? null
          : (JSON.parse(String(row['bank_details'])) as Record<string, unknown>),
      is_vat_registered: Number(row['is_vat_registered'] ?? 0) !== 0,
    }
  }

  /**
   * FR-5.1: issuing is what earns a number.
   *
   * The device does NOT invent one. It flips the status and leaves
   * `invoice_number` null; the server allocates from its per-year counter when
   * the row arrives, which is the only place that can be gap-free across
   * devices (architecture.md §8.2). Until then the UI shows "assigned on sync".
   */
  async issue(id: string): Promise<void> {
    const invoice = await this.findSummary(id)
    if (!invoice) throw new InvoiceRuleError('Invoice not found on this device.')
    if (invoice.status !== 'draft') {
      throw new InvoiceRuleError('This invoice has already been issued.')
    }
    if (invoice.total_cents <= 0) {
      throw new InvoiceRuleError('An invoice must have a total before it can be issued.')
    }
    await this.invoices.update(id, { status: 'issued' } as never)
  }

  /** FR-5.6. A voided invoice keeps its number, so nothing is ever reused. */
  async voidInvoice(id: string, reason: string): Promise<void> {
    if (this.scope.role !== 'owner' && this.scope.role !== 'manager') {
      throw new InvoiceRuleError('Only a manager or the owner can void an invoice.')
    }
    if (!reason.trim()) throw new InvoiceRuleError('Give a reason for voiding this invoice.')

    const invoice = await this.findSummary(id)
    if (!invoice) throw new InvoiceRuleError('Invoice not found on this device.')
    if (invoice.status === 'voided') throw new InvoiceRuleError('This invoice is already voided.')
    if (invoice.paidCents > 0) {
      throw new InvoiceRuleError(
        'This invoice has payments against it. Reverse them before voiding it.',
      )
    }

    await this.invoices.update(id, {
      status: 'voided',
      voided_at: this.now(),
      voided_by: this.scope.userId,
      void_reason: reason.trim(),
    } as never)
  }

  /** FR-5.3, FR-5.4. Partial payments are simply more rows. */
  async recordPayment(input: NewPaymentInput): Promise<void> {
    const invoice = await this.findSummary(input.invoiceId)
    if (!invoice) throw new InvoiceRuleError('Invoice not found on this device.')
    if (invoice.status === 'draft') {
      throw new InvoiceRuleError('Issue the invoice before recording a payment against it.')
    }
    if (invoice.status === 'voided') {
      throw new InvoiceRuleError('A voided invoice cannot take payments.')
    }
    if (input.amountCents <= 0) {
      throw new InvoiceRuleError('A payment must be more than zero.')
    }

    await this.payments.insert({
      id: input.id,
      invoice_id: input.invoiceId,
      amount_cents: input.amountCents,
      method: input.method,
      reference: input.reference,
      paid_at: input.paidAt,
      received_by: this.scope.userId,
      notes: input.notes,
    } as never)
  }

  /**
   * FR-5.5: corrections are reversal entries, never edits or deletions.
   *
   * Restricted to manager and owner here and by the `reversals_insert` policy.
   * The total reversed against a payment may not exceed it — checked here for
   * an immediate answer, and by a server trigger because other reversals may
   * still be unsynced on another device.
   */
  async reversePayment(input: {
    id: string
    paymentId: string
    amountCents: number
    reason: string
  }): Promise<void> {
    if (this.scope.role !== 'owner' && this.scope.role !== 'manager') {
      throw new InvoiceRuleError('Only a manager or the owner can reverse a payment.')
    }
    if (!input.reason.trim()) throw new InvoiceRuleError('Give a reason for the reversal.')
    if (input.amountCents <= 0) throw new InvoiceRuleError('A reversal must be more than zero.')

    const rows = await this.db.select<{ amount_cents: number; reversed: number }>(
      `SELECT p.amount_cents,
              COALESCE((SELECT SUM(amount_cents) FROM reversals WHERE payment_id = p.id), 0) AS reversed
       FROM payments p WHERE p.id = ?`,
      [input.paymentId],
    )
    const payment = rows[0]
    if (!payment) throw new InvoiceRuleError('Payment not found on this device.')

    const remaining = Number(payment.amount_cents) - Number(payment.reversed)
    if (input.amountCents > remaining) {
      throw new InvoiceRuleError(`Only ${remaining} cents of that payment remain to reverse.`)
    }

    await this.reversals.insert({
      id: input.id,
      payment_id: input.paymentId,
      amount_cents: input.amountCents,
      reason: input.reason.trim(),
      reversed_at: this.now(),
    } as never)
  }
}
