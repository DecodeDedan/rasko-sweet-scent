import type { Role } from '../../auth/session.js'

/** FR-7.2. The pipeline a purchase moves through, in order. */
export type PurchaseStatus = 'ordered' | 'received' | 'paid'

export const PURCHASE_STATUSES: readonly PurchaseStatus[] = ['ordered', 'received', 'paid']

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  ordered: 'Ordered',
  received: 'Received',
  paid: 'Paid',
}

/**
 * FR-7.6: stock moves on receipt and at no other point, so the pipeline is
 * strictly forward. `app.receive_purchase_into_stock` fires on the transition
 * into `received`; letting a purchase step backwards out of it would strand
 * `purchase_in` movements with nothing explaining them.
 */
const NEXT: Record<PurchaseStatus, readonly PurchaseStatus[]> = {
  ordered: ['received'],
  received: ['paid'],
  paid: [],
}

export function nextPurchaseStatuses(from: PurchaseStatus): readonly PurchaseStatus[] {
  return NEXT[from]
}

export function canTransitionPurchase(from: PurchaseStatus, to: PurchaseStatus): boolean {
  return NEXT[from].includes(to)
}

/** FR-7.5: owner and manager write; accountant reads. Sales never sees the module. */
export function canWriteSuppliers(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

/** Mirrors `supplier_payments_insert`: accountant may record a payment. */
export function canRecordSupplierPayment(role: Role): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant'
}

export function canSeeSuppliers(role: Role): boolean {
  return canRecordSupplierPayment(role)
}

export interface Supplier {
  id: string
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  payment_terms_days: number
  kra_pin: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

export interface SupplierSummary extends Supplier {
  purchaseCount: number
  /** Lifetime purchase value, for ranking who the business actually buys from. */
  purchasedCents: number
  /** FR-7.4: total_cents less payments, over unpaid purchases. */
  payableCents: number
  lastPurchaseAt: string | null
}

export interface Purchase {
  id: string
  purchase_number: string | null
  supplier_id: string
  status: PurchaseStatus
  purchase_date: string
  due_date: string | null
  total_cents: number
  received_at: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

export interface PurchaseSummary extends Purchase {
  supplierName: string
  itemCount: number
  paidCents: number
  balanceCents: number
  /** FR-7.4 aging: days past due_date, 0 when not yet due or already paid. */
  daysOverdue: number
}

export interface PurchaseItem {
  id: string
  purchase_id: string
  product_id: string
  productName: string
  productSku: string
  quantity: number
  unit_cost_cents: number
  line_total_cents: number
}

export interface SupplierPayment {
  id: string
  purchase_id: string
  purchaseNumber: string | null
  amount_cents: number
  method: SupplierPaymentMethod
  reference: string | null
  paid_at: string
  created_by: string | null
}

export type SupplierPaymentMethod = 'mpesa' | 'cash' | 'bank_transfer' | 'cheque'

export const SUPPLIER_PAYMENT_METHODS: readonly SupplierPaymentMethod[] = [
  'mpesa',
  'cash',
  'bank_transfer',
  'cheque',
]

export const SUPPLIER_PAYMENT_METHOD_LABEL: Record<SupplierPaymentMethod, string> = {
  mpesa: 'M-Pesa',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
}

export interface PurchaseDetail extends PurchaseSummary {
  items: PurchaseItem[]
  payments: SupplierPayment[]
}

export interface SupplierDetail extends SupplierSummary {
  purchases: PurchaseSummary[]
}

/** FR-7.4 / FR-2.5: the standard receivables buckets, applied to payables. */
export interface AgingBucket {
  label: string
  minDays: number
  maxDays: number | null
  amountCents: number
  purchaseCount: number
}

export const AGING_BUCKETS: ReadonlyArray<Pick<AgingBucket, 'label' | 'minDays' | 'maxDays'>> = [
  { label: '0–30 days', minDays: 0, maxDays: 30 },
  { label: '31–60 days', minDays: 31, maxDays: 60 },
  { label: '61–90 days', minDays: 61, maxDays: 90 },
  { label: '90+ days', minDays: 91, maxDays: null },
]

export type SupplierView = 'suppliers' | 'purchases' | 'payables'

export interface SupplierQuery {
  search?: string
  view?: SupplierView
  status?: PurchaseStatus | 'all'
}

export interface NewPurchaseLine {
  productId: string
  quantity: number
  unitCostCents: number
}

export interface NewPurchaseInput {
  id: string
  supplierId: string
  purchaseDate: string
  dueDate?: string | null
  lines: readonly NewPurchaseLine[]
}
