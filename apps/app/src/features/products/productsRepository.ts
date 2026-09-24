import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import { reasonRequired, signFor } from './types.js'
import type {
  Category,
  MovementType,
  Product,
  ProductQuery,
  ProductStock,
  StockMovement,
  WastageRow,
} from './types.js'

/**
 * Products and inventory (FR-6.1 – FR-6.8).
 *
 * ## Current stock is never stored
 *
 * `products` has no `current_stock` column, on purpose (FR-6.2). Stock is
 * `sum(quantity)` over `stock_movements`, computed on every read. A stored copy
 * would be a second source of truth that two offline devices could each update
 * and neither could merge — the exact conflict the append-only ledger exists to
 * avoid. Every query below therefore aggregates.
 */

/**
 * categories.slug is unique among live rows. It is derived from the name, with
 * the row id appended so two names that reduce to the same slug ("Gunni" and
 * "gunni.") cannot collide, and a name with no latin letters still gets one.
 */
function categorySlug(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${base || 'category'}_${id.slice(0, 8)}`
}

export class ProductRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductRuleError'
  }
}

const STOCK_SELECT = `
  SELECT p.*,
         COALESCE(cat.name, 'Uncategorised')      AS category_name,
         COALESCE(m.total, 0)                     AS stock_raw,
         m.last_at                                AS last_movement_at
  FROM products p
  LEFT JOIN categories cat ON cat.id = p.category_id
  LEFT JOIN (
    SELECT product_id, SUM(quantity) AS total, MAX(occurred_at) AS last_at
    FROM stock_movements GROUP BY product_id
  ) m ON m.product_id = p.id
`

/** Quantities are stored as thousandths (architecture.md §9.1). */
const SCALE = 1000

function toStock(row: Record<string, unknown>): ProductStock {
  const currentStock = Number(row['stock_raw'] ?? 0) / SCALE
  const threshold = Number(row['low_stock_threshold'] ?? 0) / SCALE
  const cost = Number(row['cost_price_cents'] ?? 0)

  return {
    ...(row as unknown as Product),
    unit: String(row['unit'] ?? 'piece') as ProductStock['unit'],
    cost_price_cents: cost,
    selling_price_cents: Number(row['selling_price_cents'] ?? 0),
    low_stock_threshold: threshold,
    is_active: Number(row['is_active'] ?? 0) !== 0,
    categoryName: String(row['category_name'] ?? 'Uncategorised'),
    currentStock,
    isLowStock: currentStock <= threshold,
    isNegative: currentStock < 0,
    valuationCents: Math.round(currentStock * cost),
    lastMovementAt: row['last_movement_at'] == null ? null : String(row['last_movement_at']),
  }
}

export interface ProductsScope {
  role: Role
  userId: string | null
}

export interface NewMovementInput {
  id: string
  productId: string
  type: MovementType
  /** Always entered as a positive magnitude; the sign comes from the type. */
  quantity: number
  reason: string | null
  occurredAt?: string
  unitCostCents?: number | null
}

export class ProductsRepository {
  private readonly products: Repository<Record<string, unknown>>
  private readonly movements: Repository<Record<string, unknown>>
  private readonly categoryRows: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly scope: ProductsScope,
    private readonly context: WriteContext,
  ) {
    this.products = new Repository(db, 'products', context)
    this.movements = new Repository(db, 'stock_movements', context)
    this.categoryRows = new Repository(db, 'categories', context)
  }

  /** PRD §3.1: accountant and sales have View only on products and inventory. */
  private requireWriteAccess(): void {
    if (this.scope.role !== 'owner' && this.scope.role !== 'manager') {
      throw new ProductRuleError('Only a manager or the owner can change products or stock.')
    }
  }

  async categories(): Promise<Category[]> {
    return this.db.select<Category>(
      `SELECT id, name, slug FROM categories WHERE deleted_at IS NULL ORDER BY position, name`,
    )
  }

  async list(query: ProductQuery = {}): Promise<ProductStock[]> {
    const params: unknown[] = []
    let where = ' WHERE p.deleted_at IS NULL'

    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`
      where += ' AND (LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ?)'
      params.push(term, term)
    }
    if (query.categoryId && query.categoryId !== 'all') {
      where += ' AND p.category_id = ?'
      params.push(query.categoryId)
    }

    const rows = await this.db.select<Record<string, unknown>>(
      `${STOCK_SELECT}${where} ORDER BY p.name COLLATE NOCASE`,
      params,
    )
    const stock = rows.map(toStock)

    // Low stock depends on the aggregate, so it filters after it.
    if (query.view === 'low_stock') return stock.filter((p) => p.isLowStock)
    return stock
  }

  async findStock(id: string): Promise<ProductStock | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      `${STOCK_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    )
    const row = rows[0]
    return row ? toStock(row) : null
  }

  /** FR-6.4. */
  async lowStock(): Promise<ProductStock[]> {
    const rows = await this.list({ view: 'low_stock' })
    return rows.sort((a, b) => a.currentStock - b.currentStock)
  }

  /** FR-6.2: the ledger, newest first. */
  async movementLedger(
    options: { productId?: string; limit?: number } = {},
  ): Promise<StockMovement[]> {
    const params: unknown[] = []
    let where = ''
    if (options.productId) {
      where = ' WHERE m.product_id = ?'
      params.push(options.productId)
    }

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT m.*, p.name AS product_name, p.sku AS product_sku, p.unit AS product_unit
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       ${where}
       ORDER BY m.occurred_at DESC, m.id DESC
       LIMIT ${Math.floor(options.limit ?? 200)}`,
      params,
    )

    return rows.map((row) => ({
      id: String(row['id']),
      product_id: String(row['product_id']),
      productName: String(row['product_name'] ?? ''),
      productSku: String(row['product_sku'] ?? ''),
      unit: String(row['product_unit'] ?? 'piece') as StockMovement['unit'],
      movement_type: String(row['movement_type'] ?? 'adjustment') as MovementType,
      quantity: Number(row['quantity'] ?? 0) / SCALE,
      unit_cost_cents: row['unit_cost_cents'] == null ? null : Number(row['unit_cost_cents']),
      source_table: String(row['source_table'] ?? 'manual'),
      source_id: row['source_id'] == null ? null : String(row['source_id']),
      reason: row['reason'] == null ? null : String(row['reason']),
      occurred_at: String(row['occurred_at'] ?? ''),
      created_by: row['created_by'] == null ? null : String(row['created_by']),
    }))
  }

  /** FR-6.5: wastage by product over a period. */
  async wastageReport(fromIso: string, toIso: string): Promise<WastageRow[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT m.product_id, p.sku, p.name, p.unit,
              SUM(-m.quantity)                                   AS quantity_raw,
              SUM(-m.quantity * COALESCE(m.unit_cost_cents, p.cost_price_cents)) AS cost_raw,
              COUNT(*)                                           AS occurrences
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       WHERE m.movement_type = 'wastage' AND m.occurred_at >= ? AND m.occurred_at <= ?
       GROUP BY m.product_id, p.sku, p.name, p.unit
       ORDER BY cost_raw DESC`,
      [fromIso, toIso],
    )

    return rows.map((row) => ({
      productId: String(row['product_id']),
      sku: String(row['sku'] ?? ''),
      name: String(row['name'] ?? ''),
      unit: String(row['unit'] ?? 'piece') as WastageRow['unit'],
      quantity: Number(row['quantity_raw'] ?? 0) / SCALE,
      // quantity is thousandths and cost is cents, so the product is scaled once.
      costCents: Math.round(Number(row['cost_raw'] ?? 0) / SCALE),
      occurrences: Number(row['occurrences'] ?? 0),
    }))
  }

  /** FR-6.8: quantity x cost, per product and in total. */
  async valuation(): Promise<{ products: ProductStock[]; totalCents: number }> {
    const products = (await this.list()).filter((p) => p.currentStock !== 0)
    return {
      products,
      totalCents: products.reduce((sum, p) => sum + p.valuationCents, 0),
    }
  }

  // ------------------------------------------------------------ FR-6.1 CRUD

  async createProduct(
    values: Omit<Product, 'created_at' | 'updated_at' | 'deleted_at'>,
  ): Promise<void> {
    this.requireWriteAccess()
    if (!values.sku.trim()) throw new ProductRuleError('Enter a SKU.')
    if (!values.name.trim()) throw new ProductRuleError('Enter a product name.')
    if (!values.category_id) throw new ProductRuleError('Choose a category.')

    const clash = await this.db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM products WHERE UPPER(sku) = UPPER(?) AND deleted_at IS NULL',
      [values.sku.trim()],
    )
    if (Number(clash[0]?.n ?? 0) > 0) {
      throw new ProductRuleError(`SKU ${values.sku.trim()} is already in use.`)
    }

    await this.products.insert({
      ...values,
      sku: values.sku.trim(),
      name: values.name.trim(),
    } as never)
  }

  async updateProduct(id: string, patch: Partial<Product>): Promise<void> {
    this.requireWriteAccess()
    // Stock is not a field. It cannot be set here because it is not stored.
    await this.products.update(id, patch as never)
  }

  async softDeleteProduct(id: string): Promise<void> {
    this.requireWriteAccess()
    await this.products.softDelete(id)
  }

  // ----------------------------------------------- FR-6.1 categories

  async createCategory(id: string, name: string): Promise<void> {
    this.requireWriteAccess()
    const trimmed = await this.validCategoryName(name)
    const last = await this.db.select<{ p: number | null }>(
      'SELECT MAX(position) AS p FROM categories WHERE deleted_at IS NULL',
    )
    await this.categoryRows.insert({
      id,
      name: trimmed,
      slug: categorySlug(trimmed, id),
      // VAT applies by category (tax_config.applies_to_category_ids); whether
      // a category is VAT-able only matters once VAT is switched on (PRD §12.3).
      is_vatable: true,
      position: Number(last[0]?.p ?? 0) + 1,
    })
  }

  async renameCategory(id: string, name: string): Promise<void> {
    this.requireWriteAccess()
    const trimmed = await this.validCategoryName(name, id)
    await this.categoryRows.update(id, { name: trimmed, slug: categorySlug(trimmed, id) })
  }

  /** Refused while a product still uses it: products.category_id is NOT NULL. */
  async removeCategory(id: string): Promise<void> {
    this.requireWriteAccess()
    const inUse = await this.db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND deleted_at IS NULL',
      [id],
    )
    const count = Number(inUse[0]?.n ?? 0)
    if (count > 0) {
      throw new ProductRuleError(
        `${count} product${count === 1 ? '' : 's'} still use this category. Move them to another category first.`,
      )
    }
    await this.categoryRows.softDelete(id)
  }

  private async validCategoryName(name: string, exceptId?: string): Promise<string> {
    const trimmed = name.trim()
    if (!trimmed) throw new ProductRuleError('Enter a category name.')
    // Mirrors categories_name_key (unique on lower(name) among live rows).
    const clash = await this.db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM categories
        WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL AND id <> ?`,
      [trimmed, exceptId ?? ''],
    )
    if (Number(clash[0]?.n ?? 0) > 0) {
      throw new ProductRuleError(`There is already a category called ${trimmed}.`)
    }
    return trimmed
  }

  // -------------------------------------------------- FR-6.2 / FR-6.5 ledger

  /**
   * Records a manual stock movement.
   *
   * `sale` is not accepted here: sales are written by the order pipeline
   * (migration 0017), so that the ledger always names the order that caused
   * them and cannot be double-counted.
   */
  async recordMovement(input: NewMovementInput): Promise<void> {
    this.requireWriteAccess()

    if (input.type === 'sale') {
      throw new ProductRuleError(
        'Sales are recorded by the order, not by hand, so the ledger can point back to it.',
      )
    }
    if (!Number.isFinite(input.quantity) || input.quantity === 0) {
      throw new ProductRuleError('Enter a quantity other than zero.')
    }
    if (reasonRequired(input.type) && !input.reason?.trim()) {
      throw new ProductRuleError('Give a reason for this movement.')
    }

    const magnitude = Math.abs(input.quantity)
    const sign = signFor(input.type)
    // An adjustment may go either way, so it keeps the sign the user typed.
    const quantity = sign === 0 ? input.quantity : magnitude * sign

    const product = await this.findStock(input.productId)
    if (!product) throw new ProductRuleError('Product not found on this device.')

    await this.movements.insert({
      id: input.id,
      product_id: input.productId,
      movement_type: input.type,
      quantity,
      unit_cost_cents:
        input.unitCostCents === undefined ? product.cost_price_cents : input.unitCostCents,
      source_table: 'manual',
      source_id: null,
      reason: input.reason?.trim() ?? null,
      occurred_at: input.occurredAt ?? this.context.now?.() ?? new Date().toISOString(),
    } as never)
  }
}
