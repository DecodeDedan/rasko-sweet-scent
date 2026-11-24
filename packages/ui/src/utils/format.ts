/**
 * Display formatting for the conventions PRD §7 fixes:
 * money as "KES 12,500.00", dates as DD/MM/YYYY, times in Africa/Nairobi,
 * phone numbers in E.164 (+254 for Kenya, any country code for buyers abroad).
 *
 * These live in the design system rather than the app because they are part of
 * how the brand renders figures — pair them with the `rsk-numeric` class, which
 * supplies the tabular numerals docs/brand.md requires for money and quantity.
 */

const NAIROBI = 'Africa/Nairobi'

/**
 * Money is stored as integer minor units (PRD §7) and formatted without ever
 * becoming a float, so large values cannot drift. Sales can be priced in a
 * currency other than shillings; the ISO code leads, "USD 1,080.00", so a
 * figure is never mistaken for shillings.
 */
export function formatMoney(cents: number | bigint, currency: string = 'KES'): string {
  // A formatter must never be the thing that unmounts the screen. `BigInt(NaN)`
  // throws a RangeError, so one undefined figure anywhere in a table takes the
  // whole module down with it — which is exactly how a partial payroll row
  // turned the Payroll page blank. Render zero instead: a visible wrong number
  // can be reported, a blank page cannot.
  if (typeof cents === 'number' && !Number.isFinite(cents)) return `${currency} 0.00`

  const value = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents))
  const isNegative = value < 0n
  const absolute = isNegative ? -value : value

  const major = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const minor = (absolute % 100n).toString().padStart(2, '0')

  return `${isNegative ? '-' : ''}${currency} ${major}.${minor}`
}

/** Shillings: payroll, purchases, stock and every figure that is not a sale. */
export function formatKes(cents: number | bigint): string {
  return formatMoney(cents, 'KES')
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

/**
 * ITU country calling codes are prefix-free: these are every 1- and 2-digit
 * code; anything else is 3 digits. That is enough to split a stored E.164
 * number into "+CC national" without shipping a full numbering-plan library.
 */
const SHORT_CALLING_CODES = new Set([
  '1',
  '7',
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
])

function callingCodeLength(digits: string): number {
  if (SHORT_CALLING_CODES.has(digits.slice(0, 1))) return 1
  if (SHORT_CALLING_CODES.has(digits.slice(0, 2))) return 2
  return 3
}

/** E.164: a plus, a non-zero first digit, at most fifteen digits in all. */
const E164 = /^\+[1-9]\d{7,14}$/
const KENYAN_MOBILE = /^\+254[17]\d{8}$/

/**
 * Turns whatever was typed into stored E.164, or null when it cannot be one.
 *
 * A number typed with a leading "+" or "00" is international and kept as
 * given. Anything else is Kenyan national format (0712 004 518, 712004518,
 * 254712004518), because that is how almost every number here is typed.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
    const international = `+${trimmed.startsWith('00') ? digits.slice(2) : digits}`
    // A Kenyan number typed with its code still has to be a Kenyan mobile:
    // "+254 0712..." keeps the trunk zero and would otherwise pass as E.164.
    if (international.startsWith('+254')) {
      return KENYAN_MOBILE.test(international) ? international : null
    }
    return E164.test(international) ? international : null
  }

  const national = digits.startsWith('254') ? digits.slice(3) : digits.replace(/^0+/, '')
  const kenyan = `+254${national}`
  return KENYAN_MOBILE.test(kenyan) ? kenyan : null
}

/** True for a stored number this system accepts: any E.164, Kenyan or not. */
export function isE164Phone(phone: string): boolean {
  return E164.test(phone)
}

/**
 * +254712345678 -> "+254 712 345 678"; +31201234567 -> "+31 201 234 567".
 * Anything that is not E.164 is returned untouched rather than mangled.
 */
export function formatPhone(phone: string): string {
  if (!E164.test(phone)) return phone
  const digits = phone.slice(1)
  const codeLength = callingCodeLength(digits)
  const national = digits.slice(codeLength).replace(/(\d{3})(?=\d{3})/g, '$1 ')
  return `+${digits.slice(0, codeLength)} ${national}`
}
