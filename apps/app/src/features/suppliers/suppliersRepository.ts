import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import {
  AGING_BUCKETS,
  canRecordSupplierPayment,
  canTransitionPurchase,
  canWriteSuppliers,
} from './types.js'
import type {
  AgingBucket,
  NewPurchaseInput,
  Purchase,
  PurchaseDetail,
  PurchaseItem,
  PurchaseStatus,
  PurchaseSummary,
  Supplier,
  SupplierDetail,
  SupplierPayment,
  SupplierPaymentMethod,
  SupplierQuery,
  SupplierSummary,
} from './types.js'

/**
 * Suppliers and purchases (FR-7.1 – FR-7.6).
 *
 * ## Nothing here writes a stock movement
 *
 * FR-7.3 and FR-7.6 say receipt is what moves stock, and the server owns that:
 * `app.receive_purchase_into_stock` fires on the transition into `received` and
 * is idempotent against a unique index. This repository only sets `received_at`.
 * Writing the movements here as well would double-count the moment two devices
 * received the same purchase offline.
 *
 * ## Payable is derived, never stored
 *
 * Same rule as the invoice balance (FR-5.4): `purchases.total_cents` less the
 * sum of `supplier_payments`, computed on read. `supplier_payments` is
 * append-only, so two devices paying the same purchase offline both survive.
 */

export class SupplierRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierRuleError'
  }
}

/** Quantities are stored as thousandths (architecture.md §9.1). */
const SCALE = 1000

const PAID_SELECT = `
  SELECT purchase_id, SUM(amount_cents) AS paid
  FROM supplier_payments
  GROUP BY purchase_id
`

const PURCHASE_SELECT = `
  SELECT p.*,
         COALESCE(s.name, 'Unknown supplier') AS supplier_name,
         COALESCE(li.item_count, 0)           AS item_count,
         COALESCE(pay.paid, 0)                AS paid_cents
  FROM purchases p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN (
    SELECT purchase_id, COUNT(*) AS item_count
    FROM purchase_items WHERE deleted_at IS NULL GROUP BY purchase_id
  ) li ON li.purchase_id = p.id
  LEFT JOIN (${PAID_SELECT}) pay ON pay.purchase_id = p.id
`

const SUPPLIER_SELECT = `
  SELECT s.*,
         COALESCE(agg.purchase_count, 0) AS purchase_count,
         COALESCE(agg.purchased, 0)      AS purchased_cents,
         COALESCE(agg.outstanding, 0)    AS payable_cents,
         agg.last_at                     AS last_purchase_at
  FROM suppliers s
  LEFT JOIN (
    SELECT p.supplier_id,
           COUNT(*)                                          AS purchase_count,
           SUM(p.total_cents)                                AS purchased,
           SUM(MAX(0, p.total_cents - COALESCE(pay.paid, 0))) AS outstanding,
           MAX(p.purchase_date)                              AS last_at
    FROM purchases p
    LEFT JOIN (${PAID_SELECT}) pay ON pay.purchase_id = p.id
    WHERE p.deleted_at IS NULL
    GROUP BY p.supplier_id
  ) agg ON agg.supplier_id = s.id
`

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.floor((to - from) / 86_400_000)
}

export class SuppliersRepository {
  private readonly suppliers: Repository<Record<string, unknown>>
  private readonly purchases: Repository<Record<string, unknown>>
  private readonly items: Repository<Record<string, unknown>>
  private readonly payments: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    context: WriteContext,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.suppliers = new Repository(db, 'suppliers', context)
    this.purchases = new Repository(db, 'purchases', context)
    this.items = new Repository(db, 'purchase_items', context)
    this.payments = new Repository(db, 'supplier_payments', context)
  }

  private requireWrite(): void {
    if (!canWriteSuppliers(this.role)) {
      throw new SupplierRuleError(
        'Only an owner or manager can change suppliers and purchases (FR-7.5).',
      )
    }
  }

  // ------------------------------------------------------------- FR-7.1

  async listSuppliers(query: SupplierQuery = {}): Promise<SupplierSummary[]> {
    const clauses = ['s.deleted_at IS NULL']
    const params: unknown[] = []

    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`
      clauses.push(
        `(LOWER(s.name) LIKE ?
          OR LOWER(COALESCE(s.contact_person, '')) LIKE ?
          OR REPLACE(COALESCE(s.phone, ''), ' ', '') LIKE ?)`,
      )
      params.push(term, term, term)
    }

    const rows = await this.db.select<Record<string, unknown>>(
      `${SUPPLIER_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY s.name COLLATE NOCASE`,
      params,
    )
    return rows.map((row) => this.toSupplierSummary(row))
  }

  async findSupplier(id: string): Promise<SupplierSummary | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      `${SUPPLIER_SELECT} WHERE s.id = ?`,
      [id],
    )
    const row = rows[0]
    return row ? this.toSupplierSummary(row) : null
  }

  async supplierDetail(id: string): Promise<SupplierDetail | null> {
    const supplier = await this.findSupplier(id)
    if (!supplier) return null

    const purchases = await this.listPurchases({ view: 'purchases' }, id)
    return { ...supplier, purchases }
  }

  async createSupplier(input: Partial<Supplier> & { id: string; name: string }): Promise<Supplier> {
    this.requireWrite()
    if (!input.name.trim()) throw new SupplierRuleError('A supplier needs a name.')

    const row = await this.suppliers.insert({
      ...input,
      name: input.name.trim(),
      payment_terms_days: input.payment_terms_days ?? 0,
    })
    return row as unknown as Supplier
  }

  async updateSupplier(id: string, patch: Partial<Supplier>): Promise<void> {
    this.requireWrite()
    await this.suppliers.update(id, patch)
  }

  /**
   * Refuses while money is owed, for the same reason FR-3.5 refuses to delete a
   * client with unpaid invoices: the debt does not stop existing because the
   * record was hidden.
   */
  async softDeleteSupplier(id: string): Promise<void> {
    this.requireWrite()
    const supplier = await this.findSupplier(id)
    if (!supplier) throw new SupplierRuleError('Supplier not found on this device.')
    if (supplier.payableCents > 0) {
      throw new SupplierRuleError(
        'This supplier still has unpaid purchases. Settle them before removing the record.',
      )
    }
    await this.suppliers.softDelete(id)
  }

  // ------------------------------------------------------------- FR-7.2

  async listPurchases(query: SupplierQuery = {}, supplierId?: string): Promise<PurchaseSummary[]> {
    const clauses = ['p.deleted_at IS NULL']
    const params: unknown[] = []

    if (supplierId) {
      clauses.push('p.supplier_id = ?')
      params.push(supplierId)
    }
    if (query.status && query.status !== 'all') {
      clauses.push('p.status = ?')
      params.push(query.status)
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`
      clauses.push(`(LOWER(COALESCE(p.purchase_number, '')) LIKE ? OR LOWER(s.name) LIKE ?)`)
      params.push(term, term)
    }

    const rows = await this.db.select<Record<string, unknown>>(
      `${PURCHASE_SELECT} WHERE ${clauses.join(' AND ')}
       ORDER BY p.purchase_date DESC, p.created_at DESC`,
      params,
    )
    return rows.map((row) => this.toPurchaseSummary(row))
  }

  async findPurchase(id: string): Promise<PurchaseSummary | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      `${PURCHASE_SELECT} WHERE p.id = ?`,
      [id],
    )
    const row = rows[0]
    return row ? this.toPurchaseSummary(row) : null
  }

  async purchaseDetail(id: string): Promise<PurchaseDetail | null> {
    const purchase = await this.findPurchase(id)
    if (!purchase) return null

    const itemRows = await this.db.select<Record<string, unknown>>(
      `SELECT pi.*, COALESCE(pr.name, 'Unknown product') AS product_name,
              COALESCE(pr.sku, '') AS product_sku
       FROM purchase_items pi
       LEFT JOIN products pr ON pr.id = pi.product_id
       WHERE pi.purchase_id = ? AND pi.deleted_at IS NULL
       ORDER BY pr.name COLLATE NOCASE`,
      [id],
    )

    const paymentRows = await this.db.select<Record<string, unknown>>(
      `SELECT sp.*, p.purchase_number
       FROM supplier_payments sp
       LEFT JOIN purchases p ON p.id = sp.purchase_id
       WHERE sp.purchase_id = ?
       ORDER BY sp.paid_at DESC`,
      [id],
    )

    return {
      ...purchase,
      items: itemRows.map((row) => this.toItem(row)),
      payments: paymentRows.map((row) => this.toPayment(row)),
    }
  }

  /**
   * FR-7.2. `purchase_number` is left null: the server allocates `PUR-YYYY-NNNN`
   * from its row-locked counter when the row arrives, for the same reason a
   * device never invents an invoice number (FR-5.1).
   */
  async createPurchase(input: NewPurchaseInput): Promise<PurchaseSummary> {
    this.requireWrite()
    if (input.lines.length === 0) {
      throw new SupplierRuleError('Add at least one line to the purchase.')
    }
    for (const line of input.lines) {
      if (line.quantity <= 0) throw new SupplierRuleError('Every line needs a quantity above zero.')
      if (line.unitCostCents < 0) throw new SupplierRuleError('A unit cost cannot be negative.')
    }

    const total = input.lines.reduce(
      (sum, line) => sum + Math.round(line.quantity * line.unitCostCents),
      0,
    )

    await this.purchases.insert({
      id: input.id,
      supplier_id: input.supplierId,
      status: 'ordered',
      purchase_date: input.purchaseDate,
      due_date: input.dueDate ?? null,
      total_cents: total,
      received_at: null,
    })

    for (const line of input.lines) {
      await this.items.insert({
        id: crypto.randomUUID(),
        purchase_id: input.id,
        product_id: line.productId,
        quantity: line.quantity,
        unit_cost_cents: line.unitCostCents,
        line_total_cents: Math.round(line.quantity * line.unitCostCents),
      })
    }

    const created = await this.findPurchase(input.id)
    if (!created) throw new SupplierRuleError('The purchase could not be read back after saving.')
    return created
  }

  /**
   * FR-7.3 / FR-7.6. Setting `received_at` is the whole action — the server
   * trigger turns it into `purchase_in` movements. Marking `paid` is a label on
   * the pipeline; the money itself is recorded by `recordPayment`.
   */
  async transition(id: string, to: PurchaseStatus): Promise<void> {
    this.requireWrite()
    const purchase = await this.findPurchase(id)
    if (!purchase) throw new SupplierRuleError('Purchase not found on this device.')

    if (!canTransitionPurchase(purchase.status, to)) {
      throw new SupplierRuleError(
        `A purchase cannot move from ${purchase.status} to ${to}. Stock is written on receipt, so the pipeline only runs forward.`,
      )
    }

    const patch: Partial<Purchase> = { status: to }
    if (to === 'received') patch.received_at = this.clock()
    await this.purchases.update(id, patch)
  }

  // ------------------------------------------------------------- FR-7.4

  async recordPayment(input: {
    id: string
    purchaseId: string
    amountCents: number
    method: SupplierPaymentMethod
    reference?: string | null
    paidAt?: string
  }): Promise<void> {
    if (!canRecordSupplierPayment(this.role)) {
      throw new SupplierRuleError('You cannot record supplier payments.')
    }
    if (input.amountCents <= 0) {
      throw new SupplierRuleError('A payment must be greater than zero.')
    }

    const purchase = await this.findPurchase(input.purchaseId)
    if (!purchase) throw new SupplierRuleError('Purchase not found on this device.')
    if (input.amountCents > purchase.balanceCents) {
      throw new SupplierRuleError(
        `That is more than the ${purchase.balanceCents / 100} still owed on this purchase.`,
      )
    }

    await this.payments.insert({
      id: input.id,
      purchase_id: input.purchaseId,
      amount_cents: input.amountCents,
      method: input.method,
      reference: input.reference ?? null,
      paid_at: input.paidAt ?? this.clock(),
    })

    // Settling the last shilling closes the pipeline. Re-read rather than
    // trusting the figure above: another device's payment may have synced in.
    const after = await this.findPurchase(input.purchaseId)
    if (after && after.balanceCents <= 0 && after.status === 'received') {
      await this.purchases.update(input.purchaseId, { status: 'paid' })
    }
  }

  /** FR-7.4 / FR-2.5: what is owed, bucketed by how late it is. */
  async payablesAging(asOf: string = this.clock()): Promise<AgingBucket[]> {
    const outstanding = await this.listPurchases({ view: 'payables' })
    const buckets: AgingBucket[] = AGING_BUCKETS.map((bucket) => ({
      ...bucket,
      amountCents: 0,
      purchaseCount: 0,
    }))

    for (const purchase of outstanding) {
      if (purchase.balanceCents <= 0) continue
      const age = purchase.due_date ? Math.max(0, daysBetween(purchase.due_date, asOf)) : 0
      const bucket =
        buckets.find((candidate) =>
          candidate.maxDays === null
            ? age >= candidate.minDays
            : age >= candidate.minDays && age <= candidate.maxDays,
        ) ?? buckets[buckets.length - 1]

      if (bucket) {
        bucket.amountCents += purchase.balanceCents
        bucket.purchaseCount += 1
      }
    }

    return buckets
  }

  /** Total owed to every supplier — the figure the dashboard shows (FR-2.5). */
  async totalPayableCents(): Promise<number> {
    const purchases = await this.listPurchases({ view: 'payables' })
    return purchases.reduce((sum, purchase) => sum + Math.max(0, purchase.balanceCents), 0)
  }

  /** Catalogue options for the purchase line editor. */
  async products(): Promise<Array<{ id: string; name: string; sku: string; costCents: number }>> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT id, name, sku, cost_price_cents FROM products
       WHERE deleted_at IS NULL AND is_active = 1
       ORDER BY name COLLATE NOCASE`,
    )
    return rows.map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      sku: String(row['sku'] ?? ''),
      costCents: Number(row['cost_price_cents'] ?? 0),
    }))
  }

  // ------------------------------------------------------------- mapping

  private toSupplierSummary(row: Record<string, unknown>): SupplierSummary {
    return {
      id: String(row['id']),
      name: String(row['name']),
      contact_person: (row['contact_person'] as string | null) ?? null,
      phone: (row['phone'] as string | null) ?? null,
      email: (row['email'] as string | null) ?? null,
      payment_terms_days: Number(row['payment_terms_days'] ?? 0),
      kra_pin: (row['kra_pin'] as string | null) ?? null,
      notes: (row['notes'] as string | null) ?? null,
      created_at: (row['created_at'] as string | null) ?? null,
      updated_at: (row['updated_at'] as string | null) ?? null,
      deleted_at: (row['deleted_at'] as string | null) ?? null,
      purchaseCount: Number(row['purchase_count'] ?? 0),
      purchasedCents: Number(row['purchased_cents'] ?? 0),
      payableCents: Number(row['payable_cents'] ?? 0),
      lastPurchaseAt: (row['last_purchase_at'] as string | null) ?? null,
    }
  }

  private toPurchaseSummary(row: Record<string, unknown>): PurchaseSummary {
    const total = Number(row['total_cents'] ?? 0)
    const paid = Number(row['paid_cents'] ?? 0)
    const balance = total - paid
    const dueDate = (row['due_date'] as string | null) ?? null

    return {
      id: String(row['id']),
      purchase_number: (row['purchase_number'] as string | null) ?? null,
      supplier_id: String(row['supplier_id']),
      status: String(row['status'] ?? 'ordered') as PurchaseStatus,
      purchase_date: String(row['purchase_date']),
      due_date: dueDate,
      total_cents: total,
      received_at: (row['received_at'] as string | null) ?? null,
      created_at: (row['created_at'] as string | null) ?? null,
      updated_at: (row['updated_at'] as string | null) ?? null,
      deleted_at: (row['deleted_at'] as string | null) ?? null,
      supplierName: String(row['supplier_name'] ?? 'Unknown supplier'),
      itemCount: Number(row['item_count'] ?? 0),
      paidCents: paid,
      balanceCents: balance,
      daysOverdue: balance > 0 && dueDate ? Math.max(0, daysBetween(dueDate, this.clock())) : 0,
    }
  }

  private toItem(row: Record<string, unknown>): PurchaseItem {
    return {
      id: String(row['id']),
      purchase_id: String(row['purchase_id']),
      product_id: String(row['product_id']),
      productName: String(row['product_name'] ?? 'Unknown product'),
      productSku: String(row['product_sku'] ?? ''),
      quantity: Number(row['quantity'] ?? 0) / SCALE,
      unit_cost_cents: Number(row['unit_cost_cents'] ?? 0),
      line_total_cents: Number(row['line_total_cents'] ?? 0),
    }
  }

  private toPayment(row: Record<string, unknown>): SupplierPayment {
    return {
      id: String(row['id']),
      purchase_id: String(row['purchase_id']),
      purchaseNumber: (row['purchase_number'] as string | null) ?? null,
      amount_cents: Number(row['amount_cents'] ?? 0),
      method: String(row['method'] ?? 'cash') as SupplierPaymentMethod,
      reference: (row['reference'] as string | null) ?? null,
      paid_at: String(row['paid_at']),
      created_by: (row['created_by'] as string | null) ?? null,
    }
  }
}
