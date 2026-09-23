import { describe, expect, it } from 'vitest'

import {
  PayrollConfigError,
  computeHousingLevy,
  computeNssf,
  computePayeBeforeRelief,
  computePayroll,
  computeShif,
  validateRatesSnapshot,
} from '../statutory.js'
import type { RatesSnapshot } from '../statutory.js'

/** The figures seeded into `statutory_rates` by supabase/seed.sql. */
const RATES: RatesSnapshot = {
  paye: {
    personal_relief_cents: 240_000,
    bands: [
      { upto_cents: 2_880_000, rate_bp: 1000 },
      { upto_cents: 3_880_000, rate_bp: 2500 },
      { upto_cents: null, rate_bp: 3000 },
    ],
  },
  nssf: { tier_1_cap_cents: 800_000, tier_2_cap_cents: 7_200_000, rate_bp: 600 },
  shif: { rate_bp: 275, minimum_cents: 30_000 },
  housing_levy: { rate_bp: 150, cap_cents: null },
}

describe('NSSF (tiered, each tier capped)', () => {
  it('charges the rate on everything below the tier 1 ceiling', () => {
    // 5,000.00 is under the 8,000.00 tier 1 cap: 6% of the whole amount.
    expect(computeNssf(500_000, RATES.nssf)).toBe(30_000)
  })

  it('charges both tiers between the ceilings', () => {
    // 30,000.00 gross: 6% of 8,000 + 6% of the 22,000 in tier 2 = 6% of 30,000.
    expect(computeNssf(3_000_000, RATES.nssf)).toBe(180_000)
  })

  it('stops at the tier 2 ceiling however high pay goes', () => {
    const atCap = computeNssf(7_200_000, RATES.nssf)
    expect(atCap).toBe(432_000)
    expect(computeNssf(50_000_000, RATES.nssf)).toBe(atCap)
  })

  it('refuses a configuration whose tiers are inverted', () => {
    expect(() =>
      computeNssf(100_000, { tier_1_cap_cents: 900_000, tier_2_cap_cents: 100_000, rate_bp: 600 }),
    ).toThrow(PayrollConfigError)
  })
})

describe('SHIF (flat rate with a floor)', () => {
  it('applies the rate above the floor', () => {
    // 2.75% of 50,000.00 = 1,375.00
    expect(computeShif(5_000_000, RATES.shif)).toBe(137_500)
  })

  it('applies the minimum to low pay', () => {
    // 2.75% of 5,000.00 = 137.50, below the 300.00 floor.
    expect(computeShif(500_000, RATES.shif)).toBe(30_000)
  })

  it('is zero on zero pay rather than charging the floor', () => {
    expect(computeShif(0, RATES.shif)).toBe(0)
  })
})

describe('Housing Levy', () => {
  it('is a flat rate on gross', () => {
    expect(computeHousingLevy(5_000_000, RATES.housing_levy)).toBe(75_000)
  })

  it('honours a cap when one is legislated', () => {
    expect(computeHousingLevy(5_000_000, { rate_bp: 150, cap_cents: 50_000 })).toBe(50_000)
  })
})

describe('PAYE bands are marginal', () => {
  it('taxes only the slice inside each band', () => {
    // 28,800.00 exactly: all in band 1 at 10%.
    expect(computePayeBeforeRelief(2_880_000, RATES.paye)).toBe(288_000)

    // 38,800.00: 10% of 28,800 + 25% of the next 10,000 = 2,880 + 2,500.
    expect(computePayeBeforeRelief(3_880_000, RATES.paye)).toBe(288_000 + 250_000)

    // 50,000.00: the above plus 30% of the 11,200 above the top threshold.
    expect(computePayeBeforeRelief(5_000_000, RATES.paye)).toBe(288_000 + 250_000 + 336_000)
  })

  it('never makes a shilling cost more than it earns at a threshold', () => {
    const below = computePayeBeforeRelief(2_880_000, RATES.paye)
    const above = computePayeBeforeRelief(2_880_100, RATES.paye)
    expect(above - below).toBeLessThan(100)
  })

  it('is zero on zero or negative taxable pay', () => {
    expect(computePayeBeforeRelief(0, RATES.paye)).toBe(0)
    expect(computePayeBeforeRelief(-100, RATES.paye)).toBe(0)
  })

  it('refuses bands that do not ascend', () => {
    expect(() =>
      computePayeBeforeRelief(1_000_000, {
        personal_relief_cents: 0,
        bands: [
          { upto_cents: 500_000, rate_bp: 1000 },
          { upto_cents: 400_000, rate_bp: 2000 },
        ],
      }),
    ).toThrow(PayrollConfigError)
  })
})

describe('the full monthly computation (FR-8.4)', () => {
  it('deducts NSSF, SHIF and the levy before PAYE, as the law requires', () => {
    const result = computePayroll({ basicPayCents: 5_000_000, allowances: [] }, RATES)

    expect(result.grossCents).toBe(5_000_000)
    expect(result.nssfCents).toBe(300_000) // 6% of 50,000, all within tier 2
    expect(result.shifCents).toBe(137_500)
    expect(result.housingLevyCents).toBe(75_000)

    // Taxable is gross less those three, NOT gross.
    expect(result.taxablePayCents).toBe(5_000_000 - 300_000 - 137_500 - 75_000)

    const expectedPaye = computePayeBeforeRelief(result.taxablePayCents, RATES.paye)
    expect(result.payeBeforeReliefCents).toBe(expectedPaye)
    expect(result.payeCents).toBe(expectedPaye - 240_000)

    expect(result.netPayCents).toBe(result.grossCents - result.totalDeductionsCents)
  })

  it('computing PAYE on gross would overstate the tax — proving the order matters', () => {
    const correct = computePayroll({ basicPayCents: 5_000_000, allowances: [] }, RATES)
    const onGross = computePayeBeforeRelief(5_000_000, RATES.paye) - 240_000

    expect(correct.payeCents).toBeLessThan(onGross)
  })

  it('adds allowances into gross, so they are taxed (FR-8.2)', () => {
    const result = computePayroll(
      {
        basicPayCents: 3_000_000,
        allowances: [
          { code: 'housing', label: 'Housing', amount_cents: 500_000 },
          { code: 'transport', label: 'Transport', amount_cents: 200_000 },
        ],
      },
      RATES,
    )

    expect(result.allowancesCents).toBe(700_000)
    expect(result.grossCents).toBe(3_700_000)
  })

  it('pays a daily-rate employee for the days worked', () => {
    const result = computePayroll(
      { basicPayCents: 120_000, allowances: [], salaryType: 'daily', daysWorked: 22 },
      RATES,
    )
    expect(result.basicPayCents).toBe(2_640_000)
    expect(result.grossCents).toBe(2_640_000)
  })

  it('recovers an approved advance without touching the tax (FR-8.3)', () => {
    const plain = computePayroll({ basicPayCents: 3_000_000, allowances: [] }, RATES)
    const withAdvance = computePayroll(
      { basicPayCents: 3_000_000, allowances: [], advanceDeductionCents: 500_000 },
      RATES,
    )

    expect(withAdvance.payeCents).toBe(plain.payeCents)
    expect(withAdvance.netPayCents).toBe(plain.netPayCents - 500_000)
  })

  it('never turns personal relief into a refund', () => {
    // Low pay: banded tax lands under the relief, so PAYE floors at zero.
    const result = computePayroll({ basicPayCents: 1_500_000, allowances: [] }, RATES)
    expect(result.payeBeforeReliefCents).toBeLessThan(240_000)
    expect(result.payeCents).toBe(0)
  })

  it('surfaces a negative net rather than silently clamping it', () => {
    const result = computePayroll(
      {
        basicPayCents: 500_000,
        allowances: [],
        otherDeductions: [{ label: 'Loan', amount_cents: 900_000 }],
      },
      RATES,
    )
    expect(result.netPayCents).toBeLessThan(0)
  })

  it('follows the config when an amendment changes what precedes PAYE', () => {
    const oldLaw: RatesSnapshot = {
      ...RATES,
      paye: { ...RATES.paye, deductions_before_tax: ['nssf'] },
    }

    const current = computePayroll({ basicPayCents: 5_000_000, allowances: [] }, RATES)
    const before = computePayroll({ basicPayCents: 5_000_000, allowances: [] }, oldLaw)

    // Fewer pre-tax deductions means a larger taxable base and more PAYE.
    expect(before.taxablePayCents).toBeGreaterThan(current.taxablePayCents)
    expect(before.payeCents).toBeGreaterThan(current.payeCents)
  })

  it('keeps every figure in whole cents', () => {
    const result = computePayroll({ basicPayCents: 3_333_333, allowances: [] }, RATES)
    for (const value of Object.values(result)) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})

describe('rate validation (FR-9.3)', () => {
  it('accepts the seeded configuration', () => {
    expect(validateRatesSnapshot(RATES)).toEqual([])
  })

  it('rejects a top band that is not open-ended', () => {
    const problems = validateRatesSnapshot({
      ...RATES,
      paye: { ...RATES.paye, bands: [{ upto_cents: 1_000_000, rate_bp: 1000 }] },
    })
    expect(problems).toContain('The top PAYE band must be open-ended (upto_cents null).')
  })

  it('reports every missing scheme', () => {
    expect(validateRatesSnapshot({})).toHaveLength(4)
  })
})
