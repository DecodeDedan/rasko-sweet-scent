import { describe, expect, it } from 'vitest'

import { ROLES } from '../../../auth/session.js'
import type { Role } from '../../../auth/session.js'
import {
  ORDER_STATUSES,
  allowedTransitions,
  canCancel,
  canConvertToInvoice,
  canDelete,
  canEdit,
  checkTransition,
  isTerminal,
} from '../statusPipeline.js'
import type { OrderStatus } from '../statusPipeline.js'

/**
 * FR-4.2. This table must match `app.guard_order_transition` exactly; the
 * server is the enforcement and a disagreement shows up as a move the UI offers
 * and the server then refuses.
 */
describe('order status pipeline', () => {
  it('follows the PRD lifecycle in order', () => {
    expect(allowedTransitions('draft')).toEqual(['confirmed', 'cancelled'])
    expect(allowedTransitions('confirmed')).toEqual(['in_production', 'cancelled'])
    expect(allowedTransitions('in_production')).toEqual(['ready', 'cancelled'])
    expect(allowedTransitions('ready')).toEqual(['delivered', 'cancelled'])
    expect(allowedTransitions('delivered')).toEqual(['closed', 'cancelled'])
  })

  it('treats closed and cancelled as final', () => {
    expect(isTerminal('closed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    for (const status of ['draft', 'confirmed', 'in_production', 'ready', 'delivered'] as const) {
      expect(isTerminal(status), status).toBe(false)
    }
  })

  it('refuses every skip in the pipeline', () => {
    const illegal: Array<[OrderStatus, OrderStatus]> = [
      ['draft', 'in_production'],
      ['draft', 'ready'],
      ['draft', 'delivered'],
      ['confirmed', 'ready'],
      ['confirmed', 'delivered'],
      ['in_production', 'delivered'],
      ['ready', 'closed'],
    ]
    for (const [from, to] of illegal) {
      expect(checkTransition(from, to, 'owner').allowed, `${from} -> ${to}`).toBe(false)
    }
  })

  it('refuses to move backwards', () => {
    expect(checkTransition('confirmed', 'draft', 'owner').allowed).toBe(false)
    expect(checkTransition('delivered', 'ready', 'owner').allowed).toBe(false)
  })

  it('refuses to reopen a closed or cancelled order for anyone', () => {
    for (const role of ROLES) {
      for (const to of ORDER_STATUSES) {
        expect(checkTransition('closed', to, role).allowed, `closed -> ${to} as ${role}`).toBe(
          false,
        )
        expect(checkTransition('cancelled', to, role).allowed).toBe(false)
      }
    }
  })

  // ------------------------------------------------------------ FR-4.2 cancel

  it('lets only a manager or the owner cancel', () => {
    expect(canCancel('owner')).toBe(true)
    expect(canCancel('manager')).toBe(true)
    expect(canCancel('accountant')).toBe(false)
    expect(canCancel('sales')).toBe(false)

    expect(checkTransition('confirmed', 'cancelled', 'sales')).toMatchObject({
      allowed: false,
      reason: 'Only a manager or the owner can cancel an order.',
    })
    expect(checkTransition('confirmed', 'cancelled', 'manager').allowed).toBe(true)
  })

  it('allows cancelling from every non-terminal state', () => {
    for (const from of ['draft', 'confirmed', 'in_production', 'ready', 'delivered'] as const) {
      expect(checkTransition(from, 'cancelled', 'owner').allowed, from).toBe(true)
    }
  })

  // ------------------------------------------------------------- FR-4.5 sales

  it('lets a sales user edit only their own draft', () => {
    const mine = { status: 'draft' as OrderStatus, created_by: 'me' }
    const theirs = { status: 'draft' as OrderStatus, created_by: 'someone-else' }
    const mineConfirmed = { status: 'confirmed' as OrderStatus, created_by: 'me' }

    expect(canEdit(mine, 'sales', 'me')).toBe(true)
    expect(canEdit(theirs, 'sales', 'me')).toBe(false)
    expect(canEdit(mineConfirmed, 'sales', 'me')).toBe(false)

    // Managers and owners are not restricted.
    expect(canEdit(theirs, 'manager', 'me')).toBe(true)
    expect(canEdit(mineConfirmed, 'owner', 'me')).toBe(true)
    // The accountant is view-only on orders (PRD §3.1).
    expect(canEdit(mine, 'accountant', 'me')).toBe(false)
  })

  it('never lets a sales user or accountant delete', () => {
    expect(canDelete('sales')).toBe(false)
    expect(canDelete('accountant')).toBe(false)
    expect(canDelete('manager')).toBe(true)
    expect(canDelete('owner')).toBe(true)
  })

  // ------------------------------------------------------------ FR-4.4

  it('only invoices an order that has been confirmed', () => {
    expect(canConvertToInvoice('draft')).toBe(false)
    expect(canConvertToInvoice('cancelled')).toBe(false)
    expect(canConvertToInvoice('confirmed')).toBe(true)
    expect(canConvertToInvoice('delivered')).toBe(true)
  })

  it('gives a usable reason for every refusal', () => {
    const roles: Role[] = [...ROLES]
    for (const role of roles) {
      for (const from of ORDER_STATUSES) {
        for (const to of ORDER_STATUSES) {
          const result = checkTransition(from, to, role)
          if (!result.allowed) {
            expect(result.reason, `${from} -> ${to} as ${role}`).toBeTruthy()
            expect(result.reason?.endsWith('.')).toBe(true)
          }
        }
      }
    }
  })
})
