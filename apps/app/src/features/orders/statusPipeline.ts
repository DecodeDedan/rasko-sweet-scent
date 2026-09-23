import type { Role } from '../../auth/session.js'

/**
 * The order lifecycle (FR-4.2).
 *
 * This is the single client-side statement of the pipeline. It mirrors the
 * `app.guard_order_transition` trigger, which is the enforcement — the server
 * refuses an illegal move whatever the UI believes. Keeping the table here lets
 * the screen show only the moves that will actually succeed.
 */

export type OrderStatus =
  'draft' | 'confirmed' | 'in_production' | 'ready' | 'delivered' | 'closed' | 'cancelled'

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'draft',
  'confirmed',
  'in_production',
  'ready',
  'delivered',
  'closed',
  'cancelled',
]

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  delivered: 'Delivered',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

/** Must match app.guard_order_transition exactly. */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_production', 'cancelled'],
  in_production: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
}

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from]
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0
}

/** FR-4.2: cancelling is a manager or owner action. */
export function canCancel(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export interface TransitionCheck {
  allowed: boolean
  /** Why not, ready to show. Null when allowed. */
  reason: string | null
}

/**
 * Can this role move this order from `from` to `to`?
 *
 * Answers both halves — is the move legal, and may this person make it — so a
 * caller cannot check one and forget the other.
 */
export function checkTransition(from: OrderStatus, to: OrderStatus, role: Role): TransitionCheck {
  if (from === to) return { allowed: false, reason: 'The order is already in that state.' }

  if (isTerminal(from)) {
    return {
      allowed: false,
      reason: `A ${ORDER_STATUS_LABEL[from].toLowerCase()} order cannot be changed.`,
    }
  }

  if (!TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      reason: `An order cannot go from ${ORDER_STATUS_LABEL[from].toLowerCase()} to ${ORDER_STATUS_LABEL[to].toLowerCase()}.`,
    }
  }

  if (to === 'cancelled' && !canCancel(role)) {
    return { allowed: false, reason: 'Only a manager or the owner can cancel an order.' }
  }

  return { allowed: true, reason: null }
}

/**
 * FR-4.5: a sales user may edit only their own orders, and only while draft.
 * The `orders_update_sales` RLS policy is what enforces it.
 */
export function canEdit(
  order: { status: OrderStatus; created_by: string | null },
  role: Role,
  userId: string | null,
): boolean {
  if (role === 'owner' || role === 'manager') return true
  if (role === 'sales') return order.status === 'draft' && order.created_by === userId
  return false
}

/** FR-4.5: sales never deletes. Deleting is a manager or owner action. */
export function canDelete(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

/** FR-4.4: only a confirmed order becomes an invoice. */
export function canConvertToInvoice(status: OrderStatus): boolean {
  return status !== 'draft' && status !== 'cancelled'
}
