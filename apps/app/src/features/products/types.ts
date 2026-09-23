export type ProductUnit = 'stem' | 'bundle' | 'piece'

export const PRODUCT_UNITS: readonly ProductUnit[] = ['stem', 'bundle', 'piece']

export const PRODUCT_UNIT_LABEL: Record<ProductUnit, string> = {
  stem: 'Stem',
  bundle: 'Bundle',
  piece: 'Piece',
}

/** FR-6.2. Every stock change is one of these. */
export type MovementType = 'purchase_in' | 'sale' | 'wastage' | 'adjustment' | 'return'

export const MOVEMENT_TYPES: readonly MovementType[] = [
  'purchase_in',
  'sale',
  'wastage',
  'adjustment',
  'return',
]

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  purchase_in: 'Purchase in',
  sale: 'Sale',
  wastage: 'Wastage',
  adjustment: 'Adjustment',
  return: 'Return',
}

/** The types a person records by hand; sales come from the order pipeline. */
export const MANUAL_MOVEMENT_TYPES: readonly MovementType[] = [
  'purchase_in',
  'wastage',
  'adjustment',
  'return',
]

/** FR-6.2 / FR-6.5: these two are chosen freely, so they must say why. */
export function reasonRequired(type: MovementType): boolean {
  return type === 'wastage' || type === 'adjustment'
}

/** Sign convention, matching the stock_movements CHECK constraint. */
export function signFor(type: MovementType): -1 | 1 | 0 {
  if (type === 'purchase_in' || type === 'return') return 1
  if (type === 'sale' || type === 'wastage') return -1
  return 0 // adjustment may go either way
}

export interface Product {
  id: string
  sku: string
  name: string
  category_id: string
  unit: ProductUnit
  cost_price_cents: number
  selling_price_cents: number
  low_stock_threshold: number
  is_active: boolean
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

export interface ProductStock extends Product {
  categoryName: string
  /** FR-6.2: derived from movements, never a stored column. */
  currentStock: number
  isLowStock: boolean
  /** FR-6.7: allowed, but surfaced for review. */
  isNegative: boolean
  /** currentStock * cost_price_cents (FR-6.8). */
  valuationCents: number
  lastMovementAt: string | null
}

export interface StockMovement {
  id: string
  product_id: string
  productName: string
  productSku: string
  unit: ProductUnit
  movement_type: MovementType
  quantity: number
  unit_cost_cents: number | null
  source_table: string
  source_id: string | null
  reason: string | null
  occurred_at: string
  created_by: string | null
}

export interface WastageRow {
  productId: string
  sku: string
  name: string
  unit: ProductUnit
  quantity: number
  costCents: number
  occurrences: number
}

export type ProductView = 'catalogue' | 'low_stock' | 'movements' | 'wastage' | 'valuation'

export interface ProductQuery {
  search?: string
  categoryId?: string | 'all'
  view?: ProductView
}

export interface Category {
  id: string
  name: string
  slug: string
}
