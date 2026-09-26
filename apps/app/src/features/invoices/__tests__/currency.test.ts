import { describe, expect, it } from 'vitest'

import {
  centsIn,
  currenciesIn,
  currencySymbol,
  formatTotals,
  ledgerHeading,
  normaliseCurrency,
  totalsByCurrency,
} from '../currency.js'

describe('totalsByCurrency', () => {
  it('never adds one currency to another, and lists shillings first', () => {
    expect(
      totalsByCurrency([
        { currency: 'USD', cents: 10800 },
        { currency: 'KES', cents: 1260000 },
        { currency: 'USD', cents: 200 },
        { currency: null, cents: 500 },
      ]),
    ).toEqual([
      { currency: 'KES', cents: 1260500 },
      { currency: 'USD', cents: 11000 },
    ])
  })

  it('drops a currency that nets to zero', () => {
    expect(
      totalsByCurrency([
        { currency: 'EUR', cents: 500 },
        { currency: 'EUR', cents: -500 },
      ]),
    ).toEqual([])
  })
})

describe('currency helpers', () => {
  it('reads one currency out of a total list', () => {
    const totals = [{ currency: 'USD', cents: 10800 }]
    expect(centsIn(totals, 'USD')).toBe(10800)
    expect(centsIn(totals, 'KES')).toBe(0)
  })

  it('always offers shillings and orders the rest', () => {
    expect(currenciesIn([{ currency: 'USD', cents: 1 }], [{ currency: 'EUR', cents: 1 }])).toEqual([
      'KES',
      'EUR',
      'USD',
    ])
  })

  it('treats a missing or malformed code as shillings', () => {
    expect(normaliseCurrency(undefined)).toBe('KES')
    expect(normaliseCurrency('usd')).toBe('USD')
    expect(normaliseCurrency('dollars')).toBe('KES')
  })

  it('heads and marks the ledger the way the book does', () => {
    expect(ledgerHeading('KES')).toBe('Ksh')
    expect(ledgerHeading('USD')).toBe('USD')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('CHF')).toBe('CHF')
  })
})

describe('formatTotals', () => {
  it('prints each currency side by side, or shillings zero', () => {
    expect(
      formatTotals([
        { currency: 'KES', cents: 1260000 },
        { currency: 'USD', cents: 10800 },
      ]),
    ).toBe('KES 12,600.00 · USD 108.00')
    expect(formatTotals([])).toBe('KES 0.00')
  })
})
