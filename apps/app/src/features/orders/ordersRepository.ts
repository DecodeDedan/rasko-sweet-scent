import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import { checkTransition, canDelete, canEdit } from './statusPipeline.js'
import type { OrderStatus } from './statusPipeline.js'
import { activeTaxRule, computeVat } from '../invoices/vat.js'
import { normaliseCurrency } from '../invoices/currency.js'
import type {
  DeliveryGroup,
  DraftLine,
  Order,
  OrderDetail,
  OrderItem,
  OrderQuery,
  OrderSummary,
  OrderType,
  ProductOption,
} from './types.js'

/**
 * Orders data access (FR-4.1 – FR-4.7).
 *
 * Local database only; the sync engine pushes upward. Every rule enforced here
 * is also enforced on the server — the transition pipeline by
 * `app.guard_order_transition`, who may cancel by `app.guard_order_cancel`, and
 * what a sales user may touch by the `orders_update_sales` policy. These checks
 * exist so the user gets an immediate, specific answer while offline, not
 * because the server trusts them.
 */

export class OrderRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderRuleError'
  }
}

const SUMMARY_SELECT = `
  SELECT o.*,
         COALESCE(c.name, CASE WHEN o.is_walk_in = 1 THEN 'Walk-in' ELSE 'Unknown client' END) AS client_name,
         c.email AS client_email,
         COALESCE(li.item_count, 0) AS item_count
  FROM orders o
  LEFT JOIN clients c ON c.id = o.client_id
  LEFT JOIN (
    SELECT order_id, COUNT(*) AS item_count
    FROM order_items WHERE deleted_at IS NULL GROUP BY order_id
  ) li ON li.order_id = o.id
`

/** Statuses an order is still being worked on. */
const OPEN_STATUSES = ['draft', 'confirmed', 'in_production', 'ready']

function toSummary(row: Record<string, unknown>): OrderSummary {
  return {
    ...(row as unknown as Order),
    is_walk_in: Boolean(row['is_walk_in']),
    subtotal_cents: Number(row['subtotal_cents'] ?? 0),
    discount_cents: Number(row['discount_cents'] ?? 0),
    total_cents: Number(row['total_cents'] ?? 0),
    currency: normaliseCurrency(row['currency']),
    clientName: String(row['client_name'] ?? 'Unknown client'),
    clientEmail: row['client_email'] ? String(row['client_email']) : null,
    itemCount: Number(row['item_count'] ?? 0),
  }
}

export interface OrdersScope {
  role: Role
  userId: string | null
}

export interface NewOrderInput {
  id: string
  clientId: string | null
  isWalkIn: boolean
  orderType: OrderType
  deliveryAt: string | null
  deliveryAddress: string | null
  deliveryNumber?: string | null
  /** ISO 4217, keyed on the order form. Omitted means shillings. */
  currency?: string
  eventDate: string | null
  eventVenue: string | null
  eventSetupNotes: string | null
  notes: string | null
  takenBy: string
  discountCents: number
  lines: DraftLine[]
}

/** thousandths, matching the qty codec. */
function parseQuantity(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function parseMoney(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export class OrdersRepository {
  private readonly orders: Repository<Record<string, unknown>>
  private readonly items: Repository<Record<string, unknown>>
  private readonly invoices: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly scope: OrdersScope,
    private readonly context: WriteContext,
  ) {
    this.orders = new Repository(db, 'orders', context)
    this.items = new Repository(db, 'order_items', context)
    this.invoices = new Repository(db, 'invoices', context)
  }

  /**
   * FR-4.5 / PRD §3.1: a sales user sees only orders they took or created.
   * Their mirror already contains only those rows because RLS filtered the pull;
   * repeating it keeps the screen from showing something a resync would remove.
   */
  private scopeClause(params: unknown[]): string {
    if (this.scope.role === 'sales') {
      params.push(this.scope.userId ?? '', this.scope.userId ?? '')
      return ' AND (o.created_by = ? OR o.taken_by = ?)'
    }
    return ''
  }

  async list(query: OrderQuery = {}): Promise<OrderSummary[]> {
    const params: unknown[] = []
    let where = ' WHERE o.deleted_at IS NULL'

    if (query.status === 'open') {
      where += ` AND o.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`
      params.push(...OPEN_STATUSES)
    } else if (query.status && query.status !== 'all') {
      where += ' AND o.status = ?'
      params.push(query.status)
    }

    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`
      where += " AND (LOWER(o.order_number) LIKE ? OR LOWER(COALESCE(c.name, '')) LIKE ?)"
      params.push(term, term)
    }

    where += this.scopeClause(params)

    const rows = await this.db.select<Record<string, unknown>>(
      `${SUMMARY_SELECT}${where} ORDER BY COALESCE(o.delivery_at, o.created_at) DESC`,
      params,
    )
    return rows.map(toSummary)
  }

  /** FR-4.7: upcoming deliveries, grouped by the day they are due. */
  async upcomingDeliveries(fromIso: string = new Date().toISOString()): Promise<DeliveryGroup[]> {
    const params: unknown[] = [fromIso]
    let where = ` WHERE o.deleted_at IS NULL
      AND o.delivery_at IS NOT NULL
      AND o.delivery_at >= ?
      AND o.status NOT IN ('closed', 'cancelled')`
    where += this.scopeClause(params)

    const rows = await this.db.select<Record<string, unknown>>(
      `${SUMMARY_SELECT}${where} ORDER BY o.delivery_at ASC`,
      params,
    )

    const groups = new Map<string, OrderSummary[]>()
    for (const row of rows) {
      const summary = toSummary(row)
      // Group in Africa/Nairobi, not UTC: a 09:00 delivery must not land on the
      // previous day for a business three hours ahead of UTC.
      const day = new Date(summary.delivery_at ?? '').toLocaleDateString('en-CA', {
        timeZone: 'Africa/Nairobi',
      })
      const bucket = groups.get(day) ?? []
      bucket.push(summary)
      groups.set(day, bucket)
    }

    return [...groups.entries()].map(([date, orders]) => ({ date, orders }))
  }

  async findSummary(id: string): Promise<OrderSummary | null> {
    const params: unknown[] = [id]
    const where = ' WHERE o.id = ? AND o.deleted_at IS NULL' + this.scopeClause(params)
    const rows = await this.db.select<Record<string, unknown>>(SUMMARY_SELECT + where, params)
    const row = rows[0]
    return row ? toSummary(row) : null
  }

  async detail(id: string): Promise<OrderDetail | null> {
    const order = await this.findSummary(id)
    if (!order) return null

    const itemRows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM order_items WHERE order_id = ? AND deleted_at IS NULL ORDER BY position, id`,
      [id],
    )
    const items: OrderItem[] = itemRows.map((row) => ({
      id: String(row['id']),
      order_id: String(row['order_id']),
      product_id: row['product_id'] == null ? null : String(row['product_id']),
      description: String(row['description'] ?? ''),
      quantity: Number(row['quantity'] ?? 0) / 1000,
      unit_price_cents: Number(row['unit_price_cents'] ?? 0),
      discount_cents: Number(row['discount_cents'] ?? 0),
      line_total_cents: Number(row['line_total_cents'] ?? 0),
      position: Number(row['position'] ?? 0),
    }))

    const invoice = await this.db.select<{ id: string; invoice_number: string | null }>(
      `SELECT id, invoice_number FROM invoices
       WHERE order_id = ? AND deleted_at IS NULL AND status <> 'voided' LIMIT 1`,
      [id],
    )

    return {
      order,
      items,
      invoiceId: invoice[0]?.id ?? null,
      invoiceNumber: invoice[0]?.invoice_number ?? null,
    }
  }

  /** The catalogue for the line picker (FR-4.1). */
  async products(): Promise<ProductOption[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT id, sku, name, unit, selling_price_cents FROM products
       WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name COLLATE NOCASE`,
    )
    return rows.map((row) => ({
      id: String(row['id']),
      sku: String(row['sku'] ?? ''),
      name: String(row['name'] ?? ''),
      unit: String(row['unit'] ?? ''),
      selling_price_cents: Number(row['selling_price_cents'] ?? 0),
    }))
  }

  async clients(): Promise<Array<{ id: string; name: string }>> {
    return this.db.select<{ id: string; name: string }>(
      `SELECT id, name FROM clients WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    )
  }

  private lineTotals(lines: DraftLine[]): {
    subtotal: number
    prepared: Array<{ line: DraftLine; quantity: number; unitPrice: number; total: number }>
  } {
    const prepared = lines.map((line) => {
      const quantity = parseQuantity(line.quantity)
      const unitPrice = parseMoney(line.unitPrice)
      return { line, quantity, unitPrice, total: Math.round(quantity * unitPrice) }
    })
    return { subtotal: prepared.reduce((sum, l) => sum + l.total, 0), prepared }
  }

  /**
   * FR-4.1. Writes the order and its lines, and maintains the cached totals.
   *
   * The server recomputes those totals with a trigger when the rows arrive, so
   * the two must agree; the arithmetic here is the same `round(qty * price)`.
   */
  async create(input: NewOrderInput): Promise<OrderSummary> {
    if (input.lines.length === 0) {
      throw new OrderRuleError('Add at least one line to the order.')
    }

    const { subtotal, prepared } = this.lineTotals(input.lines)
    const total = subtotal - input.discountCents

    await this.orders.insert({
      id: input.id,
      client_id: input.clientId,
      is_walk_in: input.isWalkIn,
      status: 'draft',
      order_type: input.orderType,
      subtotal_cents: subtotal,
      discount_cents: input.discountCents,
      total_cents: total,
      delivery_at: input.deliveryAt,
      delivery_address: input.deliveryAddress,
      delivery_number: input.deliveryNumber ?? null,
      currency: normaliseCurrency(input.currency),
      event_date: input.eventDate,
      event_venue: input.eventVenue,
      event_setup_notes: input.eventSetupNotes,
      notes: input.notes,
      taken_by: input.takenBy,
    } as never)

    let position = 0
    for (const { line, quantity, unitPrice, total: lineTotal } of prepared) {
      position += 1
      await this.items.insert({
        id: line.key,
        order_id: input.id,
        product_id: line.productId,
        description: line.description,
        quantity,
        unit_price_cents: unitPrice,
        discount_cents: 0,
        line_total_cents: lineTotal,
        position,
      } as never)
    }

    const created = await this.findSummary(input.id)
    if (!created) throw new OrderRuleError('The order could not be read back after saving.')
    return created
  }

  /** FR-4.5: sales may edit only their own drafts. */
  async update(id: string, patch: Partial<Order>): Promise<void> {
    const order = await this.findSummary(id)
    if (!order) throw new OrderRuleError('Order not found on this device.')

    if (!canEdit(order, this.scope.role, this.scope.userId)) {
      throw new OrderRuleError(
        this.scope.role === 'sales'
          ? 'You can only edit your own orders while they are still a draft.'
          : 'You cannot edit this order.',
      )
    }
    await this.orders.update(id, patch as never)
  }

  /** FR-4.2. Validates the move and who is making it before writing. */
  async transition(id: string, to: OrderStatus, reason?: string): Promise<void> {
    const order = await this.findSummary(id)
    if (!order) throw new OrderRuleError('Order not found on this device.')

    const check = checkTransition(order.status, to, this.scope.role)
    if (!check.allowed) throw new OrderRuleError(check.reason ?? 'That change is not allowed.')

    if (to === 'cancelled' && !reason?.trim()) {
      throw new OrderRuleError('Give a reason for cancelling this order.')
    }

    const now = this.context.now?.() ?? new Date().toISOString()
    const patch: Record<string, unknown> = { status: to }

    if (to === 'confirmed') patch['confirmed_at'] = now
    if (to === 'delivered') patch['delivered_at'] = now
    if (to === 'cancelled') {
      patch['cancelled_at'] = now
      patch['cancelled_by'] = this.scope.userId
      patch['cancellation_reason'] = reason?.trim()
    }

    await this.orders.update(id, patch as never)
  }

  /**
   * FR-4.4: one click from a confirmed order to a draft invoice.
   *
   * The invoice is created as a DRAFT deliberately. Numbering is gap-free and
   * server-assigned (FR-5.1, architecture.md §8), so a number appears only once
   * the invoice is issued — which the invoices module does.
   */
  async convertToInvoice(orderId: string, invoiceId: string): Promise<string> {
    const detail = await this.detail(orderId)
    if (!detail) throw new OrderRuleError('Order not found on this device.')

    if (detail.invoiceId) {
      throw new OrderRuleError('This order already has an invoice.')
    }
    if (detail.order.status === 'draft') {
      throw new OrderRuleError('Confirm the order before invoicing it.')
    }
    if (detail.order.status === 'cancelled') {
      throw new OrderRuleError('A cancelled order cannot be invoiced.')
    }

    const client = detail.order.client_id
      ? (
          await this.db.select<Record<string, unknown>>(
            'SELECT name, phone, address, kra_pin, credit_terms_days FROM clients WHERE id = ?',
            [detail.order.client_id],
          )
        )[0]
      : null

    // FR-9.2: VAT comes from tax_config, not from a constant, so switching the
    // business to VAT registered is a settings change (PRD §12.3).
    const taxRule = await activeTaxRule(this.db)
    const vatLines = await this.db.select<Record<string, unknown>>(
      `SELECT oi.line_total_cents, p.category_id, COALESCE(c.is_vatable, 1) AS is_vatable
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE oi.order_id = ? AND oi.deleted_at IS NULL`,
      [orderId],
    )
    const vat = computeVat(
      vatLines.map((row) => ({
        lineTotalCents: Number(row['line_total_cents'] ?? 0),
        categoryId: row['category_id'] == null ? null : String(row['category_id']),
        categoryIsVatable: Number(row['is_vatable'] ?? 1) !== 0,
      })),
      taxRule,
      detail.order.discount_cents,
    )

    const terms = Number(client?.['credit_terms_days'] ?? 0)
    const issue = new Date()
    const due = new Date(issue.getTime() + terms * 24 * 60 * 60 * 1000)
    const asDate = (d: Date) => d.toISOString().slice(0, 10)

    await this.invoices.insert({
      id: invoiceId,
      order_id: orderId,
      client_id: detail.order.client_id,
      // Snapshots, so the document does not change when the record does (FR-5.2).
      client_snapshot: client
        ? {
            name: client['name'],
            phone: client['phone'],
            address: client['address'],
            kra_pin: client['kra_pin'],
          }
        : { name: 'Walk-in' },
      company_snapshot: {},
      status: 'draft',
      issue_date: asDate(issue),
      due_date: asDate(due),
      subtotal_cents: detail.order.subtotal_cents,
      discount_cents: detail.order.discount_cents,
      vat_rate_bp: vat.vatRateBp,
      vat_cents: vat.vatCents,
      total_cents: detail.order.total_cents + vat.vatCents,
      currency: normaliseCurrency(detail.order.currency),
    } as never)

    return invoiceId
  }

  /** FR-4.5: sales never deletes an order. */
  async softDelete(id: string): Promise<void> {
    if (!canDelete(this.scope.role)) {
      throw new OrderRuleError('Only a manager or the owner can delete an order.')
    }
    const order = await this.findSummary(id)
    if (!order) throw new OrderRuleError('Order not found on this device.')
    await this.orders.softDelete(id)
  }
}
