import type { OrderStatus } from './statusPipeline.js'

export type OrderType = 'standard' | 'event'

export interface Order {
  id: string
  order_number: string | null
  client_id: string | null
  is_walk_in: boolean
  status: OrderStatus
  order_type: OrderType
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  delivery_at: string | null
  delivery_address: string | null
  event_date: string | null
  event_venue: string | null
  event_setup_notes: string | null
  notes: string | null
  taken_by: string | null
  confirmed_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_reason: string | null
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

export interface OrderItem {
  id: string
  order_id: string
  /** Null for a free-text custom arrangement (FR-4.1). */
  product_id: string | null
  description: string
  quantity: number
  unit_price_cents: number
  discount_cents: number
  line_total_cents: number
  position: number
}

/** A row in the orders list: the order plus the client's name. */
export interface OrderSummary extends Order {
  clientName: string
  /** For the order confirmation email; null for a walk-in or no address on file. */
  clientEmail: string | null
  itemCount: number
}

export interface OrderDetail {
  order: OrderSummary
  items: OrderItem[]
  /** Set once FR-4.4 has produced one. */
  invoiceId: string | null
  invoiceNumber: string | null
}

export interface OrderQuery {
  search?: string
  status?: OrderStatus | 'open' | 'all'
}

/** A line the user is editing, before it becomes an order_item. */
export interface DraftLine {
  key: string
  productId: string | null
  description: string
  quantity: string
  unitPrice: string
}

export interface ProductOption {
  id: string
  sku: string
  name: string
  unit: string
  selling_price_cents: number
}

/** FR-4.7: deliveries grouped by day. */
export interface DeliveryGroup {
  date: string
  orders: OrderSummary[]
}
