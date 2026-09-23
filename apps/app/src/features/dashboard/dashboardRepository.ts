import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'

/**
 * Dashboard and reports (FR-2.1 – FR-2.8).
 *
 * Read-only: every figure is an aggregate over tables the feature modules own,
 * computed here rather than stored. A dashboard that caches its own totals is a
 * second source of truth that drifts the first time a sync lands mid-render.
 *
 * ## Scoping is applied in the query, and again by the server
 *
 * FR-2.8 gives sales "own performance only". The `scopeClause` below narrows
 * what this device draws; RLS is what actually stops a sales user reading
 * anybody else's rows. Both exist because the local mirror holds whatever the
 * last pull returned, and that pull was already scoped.
 */

export interface DailySummary {
  salesCents: number
  orderCount: number
  paymentsReceivedCents: number
  outstandingReceivablesCents: number
}

export interface TrendPoint {
  date: string
  salesCents: number
  orderCount: number
}

export interface RankedClient {
  id: string
  name: string
  totalCents: number
  orderCount: number
}

export interface RankedProduct {
  id: string
  name: string
  sku: string
  quantity: number
  totalCents: number
}

export interface AgingBucket {
  label: string
  amountCents: number
  invoiceCount: number
}

export interface StockAlert {
  id: string
  name: string
  sku: string
  currentStock: number
  threshold: number
  isNegative: boolean
}

export interface WastageAlert {
  totalCostCents: number
  occurrences: number
  topProduct: string | null
}

const SCALE = 1000
const DAY_MS = 86_400_000

/**
 * Africa/Nairobi is UTC+3 all year — no DST — so the shift is a constant.
 *
 * Timestamps are stored as UTC. Every "which day does this belong to" question
 * on this screen is asked in local time, so the two have to be brought into the
 * same frame before they are compared. Without the shift an order placed at
 * 02:16 Nairobi reads as yesterday, and "today's sales" quietly omits the early
 * morning — which for a cut-foliage grower is when the day's trade happens.
 */
const NAIROBI_OFFSET = '+3 hours'

/** A stored UTC timestamp as its Nairobi calendar day. */
function nairobiDay(column: string): string {
  return `date(${column}, '${NAIROBI_OFFSET}')`
}

/** A stored UTC timestamp as its Nairobi calendar month. */
function nairobiMonth(column: string): string {
  return `strftime('%Y-%m', ${column}, '${NAIROBI_OFFSET}')`
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

export class DashboardRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    private readonly userId: string | null,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /** FR-2.8. Sales sees only what they took; every other role sees everything. */
  private scope(alias: string): { clause: string; params: unknown[] } {
    if (this.role === 'sales' && this.userId) {
      return { clause: ` AND ${alias}.created_by = ?`, params: [this.userId] }
    }
    return { clause: '', params: [] }
  }

  /** FR-2.1. Today in Africa/Nairobi, which is what "today's sales" means to the user. */
  async dailySummary(onDate?: string): Promise<DailySummary> {
    const today = onDate ?? this.nairobiToday()
    const orderScope = this.scope('o')
    const invoiceScope = this.scope('i')

    const orders = await this.db.select<{ total: number; n: number }>(
      `SELECT COALESCE(SUM(o.total_cents), 0) AS total, COUNT(*) AS n
       FROM orders o
       WHERE o.deleted_at IS NULL AND o.status <> 'cancelled'
         AND ${nairobiDay('o.created_at')} = ?${orderScope.clause}`,
      [today, ...orderScope.params],
    )

    // Payments are scoped through their invoice, since a payment has no client.
    const payments = await this.db.select<{ total: number }>(
      `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE ${nairobiDay('p.paid_at')} = ?${invoiceScope.clause}`,
      [today, ...invoiceScope.params],
    )

    const receivables = await this.db.select<{ total: number }>(
      `SELECT COALESCE(SUM(i.total_cents - COALESCE(paid.amount, 0)), 0) AS total
       FROM invoices i
       LEFT JOIN (
         SELECT invoice_id, SUM(amount_cents) AS amount FROM payments GROUP BY invoice_id
       ) paid ON paid.invoice_id = i.id
       WHERE i.deleted_at IS NULL AND i.status NOT IN ('draft', 'voided')
         AND i.total_cents > COALESCE(paid.amount, 0)${invoiceScope.clause}`,
      invoiceScope.params,
    )

    return {
      salesCents: Number(orders[0]?.total ?? 0),
      orderCount: Number(orders[0]?.n ?? 0),
      paymentsReceivedCents: Number(payments[0]?.total ?? 0),
      outstandingReceivablesCents: Number(receivables[0]?.total ?? 0),
    }
  }

  /** FR-2.2. Every day appears, including the ones with no sales — a gap would read as missing data. */
  async salesTrend(days = 30, endDate?: string): Promise<TrendPoint[]> {
    const end = endDate ?? this.nairobiToday()
    const endMs = Date.parse(`${end}T00:00:00.000Z`)
    const start = new Date(endMs - (days - 1) * DAY_MS).toISOString().slice(0, 10)
    const orderScope = this.scope('o')

    const rows = await this.db.select<{ day: string; total: number; n: number }>(
      `SELECT ${nairobiDay('o.created_at')} AS day,
              COALESCE(SUM(o.total_cents), 0) AS total,
              COUNT(*) AS n
       FROM orders o
       WHERE o.deleted_at IS NULL AND o.status <> 'cancelled'
         AND ${nairobiDay('o.created_at')} BETWEEN ? AND ?${orderScope.clause}
       GROUP BY day`,
      [start, end, ...orderScope.params],
    )

    const byDay = new Map(rows.map((row) => [row.day, row]))
    const points: TrendPoint[] = []

    for (let index = 0; index < days; index += 1) {
      const date = new Date(endMs - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10)
      const row = byDay.get(date)
      points.push({
        date,
        salesCents: Number(row?.total ?? 0),
        orderCount: Number(row?.n ?? 0),
      })
    }

    return points
  }

  /** FR-2.3. */
  async topClients(limit = 5, month?: string): Promise<RankedClient[]> {
    const period = month ?? this.nairobiToday().slice(0, 7)
    const orderScope = this.scope('o')

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT c.id, c.name,
              COALESCE(SUM(o.total_cents), 0) AS total,
              COUNT(*) AS n
       FROM orders o
       JOIN clients c ON c.id = o.client_id
       WHERE o.deleted_at IS NULL AND o.status <> 'cancelled'
         AND ${nairobiMonth('o.created_at')} = ?${orderScope.clause}
       GROUP BY c.id, c.name
       ORDER BY total DESC
       LIMIT ?`,
      [period, ...orderScope.params, limit],
    )

    return rows.map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      totalCents: Number(row['total'] ?? 0),
      orderCount: Number(row['n'] ?? 0),
    }))
  }

  /** FR-2.3. Ranked by value, not volume — a cheap high-runner is not the top product. */
  async topProducts(limit = 5, month?: string): Promise<RankedProduct[]> {
    const period = month ?? this.nairobiToday().slice(0, 7)
    const orderScope = this.scope('o')

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT p.id, p.name, p.sku,
              COALESCE(SUM(oi.quantity), 0)        AS quantity,
              COALESCE(SUM(oi.line_total_cents), 0) AS total
       FROM order_items oi
       JOIN orders o   ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE oi.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status <> 'cancelled'
         AND ${nairobiMonth('o.created_at')} = ?${orderScope.clause}
       GROUP BY p.id, p.name, p.sku
       ORDER BY total DESC
       LIMIT ?`,
      [period, ...orderScope.params, limit],
    )

    return rows.map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      sku: String(row['sku'] ?? ''),
      quantity: Number(row['quantity'] ?? 0) / SCALE,
      totalCents: Number(row['total'] ?? 0),
    }))
  }

  /** FR-2.4. The same buckets the payables report uses, so the two read alike. */
  async receivablesAging(asOf?: string): Promise<AgingBucket[]> {
    const today = asOf ?? this.nairobiToday()
    const invoiceScope = this.scope('i')

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT i.due_date, i.total_cents - COALESCE(paid.amount, 0) AS balance
       FROM invoices i
       LEFT JOIN (
         SELECT invoice_id, SUM(amount_cents) AS amount FROM payments GROUP BY invoice_id
       ) paid ON paid.invoice_id = i.id
       WHERE i.deleted_at IS NULL AND i.status NOT IN ('draft', 'voided')
         AND i.total_cents > COALESCE(paid.amount, 0)${invoiceScope.clause}`,
      invoiceScope.params,
    )

    const buckets: AgingBucket[] = [
      { label: '0–30 days', amountCents: 0, invoiceCount: 0 },
      { label: '31–60 days', amountCents: 0, invoiceCount: 0 },
      { label: '61–90 days', amountCents: 0, invoiceCount: 0 },
      { label: '90+ days', amountCents: 0, invoiceCount: 0 },
    ]

    const todayMs = Date.parse(`${today}T00:00:00.000Z`)

    for (const row of rows) {
      const dueDate = row['due_date'] ? String(row['due_date']) : null
      const balance = Number(row['balance'] ?? 0)
      if (balance <= 0) continue

      const age = dueDate
        ? Math.max(
            0,
            Math.floor((todayMs - Date.parse(`${dayKey(dueDate)}T00:00:00.000Z`)) / DAY_MS),
          )
        : 0

      const index = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3
      const bucket = buckets[index]
      if (bucket) {
        bucket.amountCents += balance
        bucket.invoiceCount += 1
      }
    }

    return buckets
  }

  /** FR-2.5. */
  async payablesTotalCents(): Promise<number> {
    const rows = await this.db.select<{ total: number }>(
      `SELECT COALESCE(SUM(p.total_cents - COALESCE(paid.amount, 0)), 0) AS total
       FROM purchases p
       LEFT JOIN (
         SELECT purchase_id, SUM(amount_cents) AS amount FROM supplier_payments GROUP BY purchase_id
       ) paid ON paid.purchase_id = p.id
       WHERE p.deleted_at IS NULL AND p.total_cents > COALESCE(paid.amount, 0)`,
    )
    return Number(rows[0]?.total ?? 0)
  }

  /** FR-2.6. Stock is summed from the ledger here too — never a stored column. */
  async lowStockAlerts(limit = 10): Promise<StockAlert[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT p.id, p.name, p.sku, p.low_stock_threshold,
              COALESCE(m.total, 0) AS stock
       FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS total FROM stock_movements GROUP BY product_id
       ) m ON m.product_id = p.id
       WHERE p.deleted_at IS NULL AND p.is_active = 1
         AND COALESCE(m.total, 0) <= p.low_stock_threshold
       -- Negative stock first: FR-6.7 treats it as a distinct, worse state than
       -- merely being under threshold, and two products can sit the same
       -- distance below their own thresholds while only one has actually run out.
       ORDER BY (COALESCE(m.total, 0) < 0) DESC,
                (COALESCE(m.total, 0) - p.low_stock_threshold) ASC
       LIMIT ?`,
      [limit],
    )

    return rows.map((row) => {
      const stock = Number(row['stock'] ?? 0) / SCALE
      return {
        id: String(row['id']),
        name: String(row['name']),
        sku: String(row['sku'] ?? ''),
        currentStock: stock,
        threshold: Number(row['low_stock_threshold'] ?? 0) / SCALE,
        isNegative: stock < 0,
      }
    })
  }

  /** FR-2.6. Costed at the movement's own cost, which is what the stock actually cost. */
  async wastageAlert(days = 30, endDate?: string): Promise<WastageAlert> {
    const end = endDate ?? this.nairobiToday()
    const start = new Date(Date.parse(`${end}T00:00:00.000Z`) - days * DAY_MS)
      .toISOString()
      .slice(0, 10)

    // The division happens in JS, not in SQL. SQLite divides two integers with
    // truncation towards zero, so `SUM(...) / 1000` inside the query silently
    // drops the fraction of a cent on every group — 1.5 units at 13.33 each
    // returns 1999 rather than 2000. Quantities here are genuinely fractional
    // (a part-bundle of foliage is normal), so that loss is not theoretical.
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT p.name,
              SUM(ABS(m.quantity) * COALESCE(m.unit_cost_cents, p.cost_price_cents)) AS cost_scaled,
              COUNT(*) AS n
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       WHERE m.movement_type = 'wastage' AND ${nairobiDay('m.occurred_at')} BETWEEN ? AND ?
       GROUP BY p.id, p.name
       ORDER BY cost_scaled DESC`,
      [start, end],
    )

    return {
      totalCostCents: rows.reduce(
        (sum, row) => sum + Math.round(Number(row['cost_scaled'] ?? 0) / SCALE),
        0,
      ),
      occurrences: rows.reduce((sum, row) => sum + Number(row['n'] ?? 0), 0),
      topProduct: rows[0] ? String(rows[0]['name']) : null,
    }
  }

  /** Africa/Nairobi is UTC+3 all year — no DST, so the offset is a constant. */
  private nairobiToday(): string {
    return new Date(Date.parse(this.clock()) + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }
}

/**
 * FR-2.7. RFC 4180 quoting: a client called `Otieno, Peter` must not become two
 * columns, and a quote inside a field is doubled.
 */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const escape = (value: unknown): string => {
    const text = value == null ? '' : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
}
