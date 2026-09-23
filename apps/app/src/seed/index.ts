/**
 * Sample data for the module stubs.
 *
 * NOT PRODUCTION DATA. Every person, business and figure here is invented. It
 * exists so the shell and the design system can be reviewed with realistic
 * density — Kenyan names, +254 numbers, KES amounts — before any module is
 * built. Delete this directory when the modules read from local SQLite.
 *
 * Money is integer cents (PRD §7). Production reads these as `bigint`; plain
 * numbers are safe here because every value is far below 2^53.
 */

export interface SeedOrder {
  id: string
  orderNumber: string
  clientName: string
  status: 'draft' | 'confirmed' | 'in_production' | 'ready' | 'delivered' | 'closed'
  deliveryAt: string
  totalCents: number
  takenBy: string
}

export const SEED_ORDERS: readonly SeedOrder[] = [
  {
    id: 'o1',
    orderNumber: 'ORD-2026-0042',
    clientName: 'Menengai Events & Planning',
    status: 'in_production',
    deliveryAt: '2026-09-03T09:00:00Z',
    totalCents: 8640000,
    takenBy: 'Faith Njeri',
  },
  {
    id: 'o2',
    orderNumber: 'ORD-2026-0041',
    clientName: 'Lanet Gardens Hotel',
    status: 'confirmed',
    deliveryAt: '2026-09-02T06:30:00Z',
    totalCents: 2415000,
    takenBy: 'Samuel Kiplagat',
  },
  {
    id: 'o3',
    orderNumber: 'ORD-2026-0040',
    clientName: 'Grace Wanjiru Kamau',
    status: 'delivered',
    deliveryAt: '2026-08-30T11:00:00Z',
    totalCents: 450000,
    takenBy: 'Faith Njeri',
  },
  {
    id: 'o4',
    orderNumber: 'ORD-2026-0039',
    clientName: 'Walk-in',
    status: 'closed',
    deliveryAt: '2026-08-29T14:15:00Z',
    totalCents: 120000,
    takenBy: 'Samuel Kiplagat',
  },
  {
    id: 'o5',
    orderNumber: 'ORD-2026-0043',
    clientName: 'Mercy Chebet Kiplagat',
    status: 'draft',
    deliveryAt: '2026-09-05T08:00:00Z',
    totalCents: 185000,
    takenBy: 'Faith Njeri',
  },
]

export interface SeedInvoice {
  id: string
  invoiceNumber: string | null
  clientName: string
  issueDate: string
  dueDate: string
  totalCents: number
  paidCents: number
}

export const SEED_INVOICES: readonly SeedInvoice[] = [
  {
    id: 'i1',
    invoiceNumber: 'INV-2026-0118',
    clientName: 'Menengai Events & Planning',
    issueDate: '2026-08-31',
    dueDate: '2026-09-30',
    totalCents: 12750000,
    paidCents: 0,
  },
  {
    id: 'i2',
    invoiceNumber: 'INV-2026-0117',
    clientName: 'Lanet Gardens Hotel',
    issueDate: '2026-08-28',
    dueDate: '2026-09-27',
    totalCents: 6850000,
    paidCents: 2000000,
  },
  {
    id: 'i3',
    invoiceNumber: 'INV-2026-0116',
    clientName: 'Rift Valley Sports Club',
    issueDate: '2026-08-19',
    dueDate: '2026-08-26',
    totalCents: 3400000,
    paidCents: 3400000,
  },
  {
    id: 'i4',
    invoiceNumber: 'INV-2026-0115',
    clientName: 'Peter Otieno Ochieng',
    issueDate: '2026-07-24',
    dueDate: '2026-08-08',
    totalCents: 320000,
    paidCents: 0,
  },
  {
    // Created offline. Numbering is server-assigned on sync (FR-5.1, architecture §8).
    id: 'i5',
    invoiceNumber: null,
    clientName: 'Mercy Chebet Kiplagat',
    issueDate: '2026-09-01',
    dueDate: '2026-09-01',
    totalCents: 185000,
    paidCents: 0,
  },
]

export interface SeedSupplier {
  id: string
  name: string
  contactPerson: string
  phone: string
  payableCents: number
}

export const SEED_SUPPLIERS: readonly SeedSupplier[] = [
  {
    id: 's1',
    name: 'Naivasha Rose Growers',
    contactPerson: 'Joseph Mwangi',
    phone: '+254711330947',
    payableCents: 18400000,
  },
  {
    id: 's2',
    name: 'Molo Greens Limited',
    contactPerson: 'Esther Chepkorir',
    phone: '+254728664201',
    payableCents: 4250000,
  },
  {
    id: 's3',
    name: 'Nakuru Packaging Supplies',
    contactPerson: 'Daniel Kariuki',
    phone: '+254799118253',
    payableCents: 0,
  },
]

export interface SeedDashboardStat {
  id: string
  label: string
  value: string
  note: string
}

export const SEED_DASHBOARD_STATS: readonly SeedDashboardStat[] = [
  { id: 'd1', label: "Today's sales", value: '', note: '6 orders' },
  { id: 'd2', label: 'Payments received', value: '', note: '4 payments' },
  { id: 'd3', label: 'Outstanding receivables', value: '', note: 'Across 3 clients' },
  { id: 'd4', label: 'Owed to suppliers', value: '', note: 'Across 2 suppliers' },
]

/** Cents for the four dashboard tiles, in the order above. */
export const SEED_DASHBOARD_VALUES: readonly number[] = [1284000, 940000, 18105000, 22650000]
