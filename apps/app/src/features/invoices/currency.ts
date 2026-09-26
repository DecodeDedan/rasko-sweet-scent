import { formatMoney } from '@rasko/ui'

/**
 * The currency an order is priced in, keyed on the order and copied to its
 * invoice. Every `*_cents` figure on that order is in this currency's minor
 * unit. The server accepts any ISO 4217 code; this list is what the order
 * form offers.
 */
export const CURRENCIES = ['KES', 'USD', 'EUR', 'GBP'] as const

export type Currency = (typeof CURRENCIES)[number]

export const DEFAULT_CURRENCY: Currency = 'KES'

export const CURRENCY_LABEL: Record<Currency, string> = {
  KES: 'KES, Kenya shilling',
  USD: 'USD, US dollar',
  EUR: 'EUR, euro',
  GBP: 'GBP, pound sterling',
}

const SYMBOL: Record<string, string> = { KES: 'Ksh', USD: '$', EUR: '€', GBP: '£' }

/** Rows written before the column existed carry no code; they are shillings. */
export function normaliseCurrency(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY
}

/** The main money column's heading: the book prints "Ksh"; any other currency prints its code. */
export function ledgerHeading(code: string): string {
  return code === 'KES' ? 'Ksh' : code
}

/** Written before the total, as the book's writer puts "$" before "108". */
export function currencySymbol(code: string): string {
  return SYMBOL[code] ?? code
}

/**
 * A money figure that spans many sales. Shillings and dollars are never added
 * together, so a total is one amount per currency, shillings first.
 */
export interface MoneyTotal {
  currency: string
  cents: number
}

function currencyOrder(a: string, b: string): number {
  if (a === b) return 0
  if (a === DEFAULT_CURRENCY) return -1
  if (b === DEFAULT_CURRENCY) return 1
  return a < b ? -1 : 1
}

/** Folds (currency, cents) rows into one total per currency, dropping zeroes. */
export function totalsByCurrency(
  rows: ReadonlyArray<{ currency: unknown; cents: unknown }>,
): MoneyTotal[] {
  const sums = new Map<string, number>()
  for (const row of rows) {
    const code = normaliseCurrency(row.currency)
    sums.set(code, (sums.get(code) ?? 0) + (Number(row.cents) || 0))
  }
  return [...sums.entries()]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => currencyOrder(a, b))
    .map(([currency, cents]) => ({ currency, cents }))
}

/** The figure in one currency, zero when that currency has none. */
export function centsIn(totals: readonly MoneyTotal[], currency: string): number {
  return totals.find((t) => t.currency === currency)?.cents ?? 0
}

/** Every currency present across several totals, shillings first. */
export function currenciesIn(...lists: ReadonlyArray<readonly MoneyTotal[]>): string[] {
  const codes = new Set<string>([DEFAULT_CURRENCY])
  for (const list of lists) for (const t of list) codes.add(t.currency)
  return [...codes].sort(currencyOrder)
}

/** "KES 12,600.00 · USD 108.00"; "KES 0.00" when there is nothing. */
export function formatTotals(totals: readonly MoneyTotal[]): string {
  if (totals.length === 0) return formatMoney(0, DEFAULT_CURRENCY)
  return totals.map((t) => formatMoney(t.cents, t.currency)).join(' · ')
}
