import { describe, expect, it } from 'vitest'

import {
  formatKes,
  formatMoney,
  formatPhone,
  isE164Phone,
  normalisePhone,
} from '../utils/format.js'

describe('formatMoney', () => {
  it('leads with the currency code and keeps two decimals', () => {
    expect(formatMoney(108000, 'USD')).toBe('USD 1,080.00')
    expect(formatMoney(-2550, 'EUR')).toBe('-EUR 25.50')
    expect(formatMoney(1234567n, 'GBP')).toBe('GBP 12,345.67')
  })

  it('defaults to shillings and renders zero for a missing figure', () => {
    expect(formatMoney(1250000)).toBe('KES 12,500.00')
    expect(formatMoney(Number.NaN, 'USD')).toBe('USD 0.00')
  })

  it('leaves formatKes unchanged', () => {
    expect(formatKes(1250000)).toBe('KES 12,500.00')
  })
})

describe('phone numbers', () => {
  it('normalises every Kenyan spelling to +254', () => {
    for (const typed of ['0712 004 518', '712004518', '254712004518', '+254 712 004 518']) {
      expect(normalisePhone(typed)).toBe('+254712004518')
    }
  })

  it('keeps an international number typed with + or 00', () => {
    expect(normalisePhone('+31 20 123 4567')).toBe('+31201234567')
    expect(normalisePhone('0044 7700 900123')).toBe('+447700900123')
    expect(normalisePhone('+971 50 123 4567')).toBe('+971501234567')
  })

  it('rejects what cannot be a number', () => {
    expect(normalisePhone('12345')).toBeNull()
    expect(normalisePhone('+0123456789')).toBeNull()
    expect(normalisePhone('+1234567890123456')).toBeNull()
    expect(normalisePhone('   ')).toBeNull()
    expect(normalisePhone('+254 0712 345 678')).toBeNull()
  })

  it('groups by the country code it finds', () => {
    expect(formatPhone('+254712004518')).toBe('+254 712 004 518')
    expect(formatPhone('+31201234567')).toBe('+31 201 234 567')
    expect(formatPhone('+14155550123')).toBe('+1 415 555 0123')
    expect(formatPhone('not a number')).toBe('not a number')
    expect(isE164Phone('+447700900123')).toBe(true)
  })
})
