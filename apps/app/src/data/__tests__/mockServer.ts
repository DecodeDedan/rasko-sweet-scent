import { cursorColumn, tableSpec } from '../sqlite/tables.js'
import { SyncAuthError, SyncTransportError } from '../sync/remote.js'
import type { PullCursor, PullPage, PushResult, SyncRemote } from '../sync/remote.js'

type Row = Record<string, unknown>

/**
 * An in-memory stand-in for the Supabase side of sync.
 *
 * It models the behaviours the engine actually depends on, and no more:
 *
 *   - the server owns the cursor column's value (architecture.md §6.3), so it
 *     stamps it on every write. Accepting a device's clock here would make the
 *     test agree with a bug that loses rows in production.
 *   - upsert by client-generated id, so a replayed push is a no-op (§6.4).
 *   - append-only tables ignore duplicates instead of overwriting (§2.6).
 *   - keyset pagination over (cursor, id), so page boundaries behave.
 *   - a deactivated user is refused, which is what RLS does (T4).
 */
export class MockServer {
  private readonly tables = new Map<string, Map<string, Row>>()
  private tick = 0
  private offline = false
  private readonly deactivated = new Set<string>()
  /** Per-year invoice counters, mirroring app.document_counters. */
  private readonly invoiceCounters = new Map<number, number>()

  /**
   * Mirrors company_settings.stock_deduction_point and the
   * app.deduct_stock_for_order trigger (migration 0017).
   *
   * The trigger itself is verified directly against Postgres; this exists so a
   * device-level test can cover the whole path — deliver an order offline, sync,
   * and see stock move — rather than stopping at the push.
   */
  stockDeductionPoint: 'order_confirmed' | 'delivered' | null = 'delivered'

  /**
   * Mirrors app.sync_order_stock: a state, not an event. An order at or past the
   * deduction point has a sale movement per catalogue line, re-evaluated
   * whenever the order or its lines change — because a device that was offline
   * pushes an already-delivered order as one insert, and its lines arrive after.
   */
  private deductStockForOrder(orderId: unknown): void {
    const point = this.stockDeductionPoint
    if (!point) return

    const order = this.table('orders').get(String(orderId))
    if (!order) return

    const status = String(order['status'] ?? '')
    const atOrPast =
      point === 'order_confirmed'
        ? ['confirmed', 'in_production', 'ready', 'delivered', 'closed'].includes(status)
        : ['delivered', 'closed'].includes(status)
    if (!atOrPast) return

    const movements = this.table('stock_movements')
    for (const item of this.table('order_items').values()) {
      if (item['order_id'] !== order['id'] || !item['product_id']) continue

      // Same uniqueness the server index enforces, so a replay is a no-op.
      const key = `orders:${String(order['id'])}:${String(item['product_id'])}:sale`
      if ([...movements.values()].some((m) => m['_key'] === key)) continue

      movements.set(key, {
        _key: key,
        id: key,
        product_id: item['product_id'],
        movement_type: 'sale',
        quantity: -Number(item['quantity'] ?? 0),
        source_table: 'orders',
        source_id: order['id'],
        occurred_at: new Date().toISOString(),
        created_at: this.stamp(),
      })
    }
  }

  /**
   * Allocates the next gap-free invoice number, exactly as
   * app.allocate_document_number does: one counter per year, incremented inside
   * the same operation that stores the row, so two devices pushing at once
   * cannot receive the same number (FR-5.1).
   */
  private allocateInvoiceNumber(issueDate: unknown): string {
    const year = Number(String(issueDate ?? '').slice(0, 4)) || 2026
    const next = (this.invoiceCounters.get(year) ?? 0) + 1
    this.invoiceCounters.set(year, next)
    return `INV-${year}-${String(next).padStart(4, '0')}`
  }

  /** Every number handed out, for assertions about gaps and reuse. */
  issuedInvoiceNumbers(): string[] {
    return this.rows('invoices')
      .map((row) => row['invoice_number'])
      .filter((n): n is string => typeof n === 'string')
      .sort()
  }

  /** Monotonic server clock. Distinct per write, so ordering is total. */
  private stamp(): string {
    this.tick += 1
    return new Date(Date.UTC(2026, 8, 1) + this.tick).toISOString()
  }

  private table(name: string): Map<string, Row> {
    let table = this.tables.get(name)
    if (!table) {
      table = new Map()
      this.tables.set(name, table)
    }
    return table
  }

  setOffline(value: boolean): void {
    this.offline = value
  }

  deactivate(userId: string): void {
    this.deactivated.add(userId)
  }

  reactivate(userId: string): void {
    this.deactivated.delete(userId)
  }

  /** Direct read, for assertions. */
  rows(tableName: string): Row[] {
    return [...this.table(tableName).values()]
  }

  count(tableName: string): number {
    return this.table(tableName).size
  }

  /** Seeds a row as though another client had written it. */
  seed(tableName: string, row: Row): void {
    const column = cursorColumn(tableSpec(tableName))
    this.table(tableName).set(String(row['id']), { ...row, [column]: this.stamp() })
  }

  remoteFor(userId: string): SyncRemote {
    const guard = () => {
      if (this.offline) throw new SyncTransportError('Failed to fetch')
      if (this.deactivated.has(userId)) {
        // Every RLS policy tests is_active, so a deactivated user's requests
        // stop matching any policy — the client sees a refusal, not empty data.
        throw new SyncAuthError('permission denied for this device')
      }
    }

    return {
      pull: async (tableName, cursor, limit): Promise<PullPage> => {
        guard()
        const column = cursorColumn(tableSpec(tableName))

        const ordered = [...this.table(tableName).values()].sort((a, b) => {
          const left = String(a[column] ?? '')
          const right = String(b[column] ?? '')
          if (left !== right) return left < right ? -1 : 1
          return String(a['id']) < String(b['id']) ? -1 : 1
        })

        const after = cursor
          ? ordered.filter((row) => {
              const value = String(row[column] ?? '')
              if (value !== cursor.value) return value > cursor.value
              return String(row['id']) > cursor.id
            })
          : ordered

        const page = after.slice(0, limit)
        const last = page.at(-1)

        return {
          rows: page.map((row) => ({ ...row })),
          cursor: last
            ? ({ value: String(last[column] ?? ''), id: String(last['id']) } satisfies PullCursor)
            : cursor,
          hasMore: after.length > limit,
        }
      },

      push: async (tableName, rows, options): Promise<PushResult> => {
        guard()
        const table = this.table(tableName)
        const column = cursorColumn(tableSpec(tableName))

        for (const row of rows) {
          const id = String(row['id'])

          if (options.appendOnly && table.has(id)) {
            // Already recorded. A retried push must not duplicate it (T6) and
            // must not overwrite it (FR-5.5).
            continue
          }

          const stored: Row = { ...row, [column]: this.stamp() }

          if (tableName === 'invoices') {
            const existing = table.get(id)
            // A number, once allocated, is never changed or reused (FR-5.1) —
            // this is what makes a retried push safe.
            if (existing?.['invoice_number']) {
              stored['invoice_number'] = existing['invoice_number']
            } else if (stored['status'] !== 'draft' && !stored['invoice_number']) {
              stored['invoice_number'] = this.allocateInvoiceNumber(stored['issue_date'])
            }
          }

          table.set(id, stored)

          if (tableName === 'orders') this.deductStockForOrder(id)
          if (tableName === 'order_items') this.deductStockForOrder(stored['order_id'])
        }

        return { rejected: [] }
      },
    }
  }
}
