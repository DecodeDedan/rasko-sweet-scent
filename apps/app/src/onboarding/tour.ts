import type { Role } from '../auth/session.js'
import type { ModuleId } from '../shell/navigation.js'

/**
 * The first-run tour. Pure data, built from what this role can actually reach,
 * so a sales user is never walked to Payroll and the tour never points at a
 * button that is not on their screen.
 */

export interface TourStep {
  id: string
  /** A [data-tour] anchor. Absent: the step is a centred dialog. */
  target?: string
  title: string
  body: string
}

const MODULE_COPY: Record<ModuleId, { title: string; body: string }> = {
  dashboard: {
    title: 'Today at a glance',
    body: 'Sales, payments received, what clients owe and stock that needs attention, worked out from your records every time you look.',
  },
  clients: {
    title: 'Clients',
    body: 'Every florist, decorator and wholesaler you supply, with what they have ordered and what they still owe.',
  },
  orders: {
    title: 'Orders',
    body: 'Take an order, move it from confirmed to delivered, and turn it into an invoice in one step.',
  },
  invoices: {
    title: 'Invoices and payments',
    body: 'Issue invoices, record M-Pesa, cash or bank payments, and email invoices, receipts and reminders to clients.',
  },
  products: {
    title: 'Products and stock',
    body: 'Baby Blue, Gunni, Parvifolia and Globulus, each as standard or spray with its own price and stock. Stock is counted from every movement, so a physical count always reconciles.',
  },
  suppliers: {
    title: 'Suppliers',
    body: 'Purchases, stock received into the shed, and what you owe each supplier.',
  },
  payroll: {
    title: 'Payroll',
    body: 'Monthly runs with PAYE, NSSF, SHIF and the Housing Levy worked out from the rates in Settings, and a payslip for everyone.',
  },
  settings: {
    title: 'Settings',
    body: 'The company details printed on every document, the wording of client emails, tax and statutory rates.',
  },
  users: {
    title: 'Your team',
    body: 'Invite staff by email and choose each person’s role. They set their own password from the invitation.',
  },
  audit: {
    title: 'Audit log',
    body: 'Every sensitive change, who made it and when: payments, price changes, role changes, stock adjustments.',
  },
}

const TOUR_ORDER: readonly ModuleId[] = [
  'dashboard',
  'clients',
  'orders',
  'invoices',
  'products',
  'suppliers',
  'payroll',
  'settings',
  'users',
  'audit',
]

const ROLE_WELCOME: Record<Role, string> = {
  owner:
    'This is the whole business in one place: clients, orders, invoices, stock, suppliers and payroll. A minute here shows you where everything lives.',
  manager:
    'You run the day to day from here: clients, orders, invoices, stock and suppliers. A minute here shows you where everything lives.',
  accountant:
    'Invoices, payments, supplier bills and payroll are all here, with the figures worked out from the records. A minute here shows you around.',
  sales:
    'Your clients, their orders and their invoices are all here, and they work without signal. A minute here shows you around.',
}

export function tourSteps(input: {
  firstName: string
  role: Role
  modules: readonly ModuleId[]
}): TourStep[] {
  const reachable = new Set(input.modules)
  const moduleSteps = TOUR_ORDER.filter((id) => reachable.has(id)).map((id) => ({
    id,
    target: `nav-${id}`,
    ...MODULE_COPY[id],
  }))

  return [
    {
      id: 'welcome',
      title: `Welcome, ${input.firstName}`,
      body: ROLE_WELCOME[input.role],
    },
    ...moduleSteps,
    {
      id: 'sync',
      target: 'sync',
      title: 'Works without signal',
      body: 'Everything saves on this device first and syncs when you are online. This shows whether anything is still waiting to go up.',
    },
    {
      id: 'help',
      target: 'help',
      title: 'Come back any time',
      body: 'Open this tour again from here whenever you, or someone new, needs it.',
    },
    {
      id: 'done',
      title: 'You are ready',
      body:
        input.role === 'owner' || input.role === 'manager'
          ? 'The dashboard has a short setup list: company details, payment details, your first product and client, and your team. Each item takes you straight to it.'
          : 'Start from the dashboard. Anything you add is saved on this device at once and shared with the team on the next sync.',
    },
  ]
}

/**
 * Seen-state is per user and per device: the desktop tour points at the
 * sidebar and the phone tour at the bottom bar, so seeing one does not mean
 * the other is familiar. A new tour version shows once again.
 */
const TOUR_VERSION = 1
const storageKey = (userId: string) => `rasko.tour.v${TOUR_VERSION}.${userId}`

export function hasSeenTour(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) !== null
  } catch {
    // Storage blocked: treat as seen rather than showing the tour on every launch.
    return true
  }
}

export function markTourSeen(userId: string): void {
  try {
    window.localStorage.setItem(storageKey(userId), new Date().toISOString())
  } catch {
    // Storage blocked: the tour simply shows again next time, which is harmless.
  }
}
