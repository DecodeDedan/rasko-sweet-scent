import { describe, expect, it } from 'vitest'

import { formatKes, formatMoney } from '../utils/format.js'

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
