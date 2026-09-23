/**
 * Display formatting for the conventions PRD §7 fixes:
 * money as "KES 12,500.00", dates as DD/MM/YYYY, times in Africa/Nairobi,
 * phone numbers in +254 form.
 *
 * These live in the design system rather than the app because they are part of
 * how the brand renders figures — pair them with the `rsk-numeric` class, which
 * supplies the tabular numerals docs/brand.md requires for money and quantity.
 */

const NAIROBI = 'Africa/Nairobi'

/**
 * Money is stored as integer cents (PRD §7) and formatted without ever becoming
 * a float, so large values cannot drift.
 */
export function formatKes(cents: number | bigint): string {
  // A formatter must never be the thing that unmounts the screen. `BigInt(NaN)`
  // throws a RangeError, so one undefined figure anywhere in a table takes the
  // whole module down with it — which is exactly how a partial payroll row
  // turned the Payroll page blank. Render zero instead: a visible wrong number
  // can be reported, a blank page cannot.
  if (typeof cents === 'number' && !Number.isFinite(cents)) return 'KES 0.00'

  const value = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents))
  const isNegative = value < 0n
  const absolute = isNegative ? -value : value

  const major = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const minor = (absolute % 100n).toString().padStart(2, '0')

  return `${isNegative ? '-' : ''}KES ${major}.${minor}`
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: NAIROBI,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: NAIROBI,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/** DD/MM/YYYY in Africa/Nairobi. */
export function formatDate(value: string | number | Date): string {
  return dateFormatter.format(toDate(value))
}

/** DD/MM/YYYY HH:mm in Africa/Nairobi. */
export function formatDateTime(value: string | number | Date): string {
  const date = toDate(value)
  return `${dateFormatter.format(date)} ${timeFormatter.format(date)}`
}

/** Quantities carry up to three decimals and drop trailing zeroes. */
export function formatQuantity(value: number, unit?: string): string {
  const text = value
    .toFixed(3)
    .replace(/\.?0+$/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return unit ? `${text} ${unit}` : text
}

/** Renders a stored +2547XXXXXXXX number as +254 7XX XXX XXX. */
export function formatPhone(phone: string): string {
  const match = /^\+254(\d)(\d{2})(\d{3})(\d{3})$/.exec(phone)
  if (!match) return phone
  return `+254 ${match[1]}${match[2]} ${match[3]} ${match[4]}`
}
