import type { MoneyTotal } from '../invoices/currency.js'

export type ClientType = 'individual' | 'corporate' | 'event_planner'

export const CLIENT_TYPES: readonly ClientType[] = ['individual', 'corporate', 'event_planner']

export const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  individual: 'Individual',
  corporate: 'Corporate',
  event_planner: 'Event planner',
}

/** A row of `clients` (FR-3.1). */
export interface Client {
  id: string
  name: string
  client_type: ClientType
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
}

/** A client plus the figures the list and detail screens show (FR-3.2, FR-3.3). */
export interface ClientSummary extends Client {
  /** Total of every issued invoice, all time, one amount per currency. */
  lifetime: MoneyTotal[]
  /** Invoiced minus paid plus reversed, over issued invoices, one amount per currency. */
  outstanding: MoneyTotal[]
  invoiceCount: number
  orderCount: number
  lastActivityAt: string | null
}

export type ClientSort = 'name' | 'recent' | 'outstanding'

export interface ClientQuery {
  /** Matches name or phone (FR-3.2). */
  search?: string
  type?: ClientType | 'all'
  sort?: ClientSort
}

export interface ClientOrderRow {
  id: string
  order_number: string | null
  status: string
  delivery_at: string | null
  total_cents: number
  /** ISO 4217; every amount on the row is in it. */
  currency: string
}

export interface ClientInvoiceRow {
  id: string
  invoice_number: string | null
  status: string
  issue_date: string | null
  due_date: string | null
  total_cents: number
  paid_cents: number
  balance_cents: number
  /** ISO 4217; every amount on the row is in it. */
  currency: string
}

export interface ClientPaymentRow {
  id: string
  invoice_number: string | null
  amount_cents: number
  /** The invoice's currency: a payment has none of its own. */
  currency: string
  method: string
  paid_at: string | null
  reference: string | null
}

export interface ClientDetail {
  client: ClientSummary
  orders: ClientOrderRow[]
  invoices: ClientInvoiceRow[]
  payments: ClientPaymentRow[]
}
