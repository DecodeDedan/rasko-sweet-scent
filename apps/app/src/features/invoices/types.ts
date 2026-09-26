/** What a human sets. The rest of FR-5.6 is derived — see deriveStatus. */
export type InvoiceStoredStatus = 'draft' | 'issued' | 'voided'

/** The full FR-5.6 list, as the user sees it. */
export type InvoiceStatus = 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'voided'

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  voided: 'Voided',
}

export type PaymentMethod = 'mpesa' | 'cash' | 'bank_transfer' | 'cheque'

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'mpesa',
  'cash',
  'bank_transfer',
  'cheque',
]

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  mpesa: 'M-Pesa',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
}

export interface Invoice {
  id: string
  invoice_number: string | null
  order_id: string | null
  client_id: string | null
  client_snapshot: Record<string, unknown> | null
  company_snapshot: Record<string, unknown> | null
  status: InvoiceStoredStatus
  issue_date: string
  due_date: string
  subtotal_cents: number
  discount_cents: number
  vat_rate_bp: number
  vat_cents: number
  total_cents: number
  /** ISO 4217, copied from the order; every *_cents figure is in its minor unit. */
  currency: string
  voided_at: string | null
  void_reason: string | null
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

export interface InvoiceSummary extends Invoice {
  clientName: string
  /** For the FR-5.8 follow-up list, so chasing needs no second query. */
  clientPhone: string | null
  /** Payments less reversals. */
  paidCents: number
  reversedCents: number
  balanceCents: number
  /** FR-5.6, computed at read time. */
  derivedStatus: InvoiceStatus
  daysOverdue: number
}

export interface PaymentRecord {
  id: string
  invoice_id: string
  amount_cents: number
  method: PaymentMethod
  reference: string | null
  paid_at: string
  received_by: string | null
  notes: string | null
  created_at: string | null
  /** Total reversed against this payment. */
  reversedCents: number
}

export interface ReversalRecord {
  id: string
  payment_id: string
  amount_cents: number
  reason: string
  reversed_at: string
  created_by: string | null
}

/** One printed particulars row, taken from the invoiced order's lines. */
export interface InvoiceLine {
  description: string
  quantity: number
  unitPriceCents: number
  discountCents: number
  lineTotalCents: number
}

export interface InvoiceDetail {
  invoice: InvoiceSummary
  /** Empty for an invoice raised without an order. */
  lines: InvoiceLine[]
  orderNumber: string | null
  /** The order's "Delivery No", printed in the letterhead. */
  deliveryNumber: string | null
  payments: PaymentRecord[]
  reversals: ReversalRecord[]
  /** Contact details for follow-up (FR-5.8). */
  clientPhone: string | null
  clientEmail: string | null
}

export interface CompanySettings {
  company_name: string
  address: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  kra_pin: string | null
  mpesa_paybill: string | null
  mpesa_till: string | null
  bank_details: Record<string, unknown> | null
  is_vat_registered: boolean
}

export type InvoiceView = 'all' | 'outstanding' | 'overdue' | 'draft'

export interface InvoiceQuery {
  search?: string
  view?: InvoiceView
}
