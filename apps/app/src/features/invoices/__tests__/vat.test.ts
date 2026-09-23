import { describe, expect, it } from 'vitest'

import { computeVat } from '../vat.js'
import type { TaxRule, VatLine } from '../vat.js'

const OFF: TaxRule = { isEnabled: false, rateBp: 1600, appliesToCategoryIds: [] }
const ON: TaxRule = { isEnabled: true, rateBp: 1600, appliesToCategoryIds: [] }

const line = (total: number, categoryId: string | null = 'flowers', vatable = true): VatLine => ({
  lineTotalCents: total,
  categoryId,
  categoryIsVatable: vatable,
})

/**
 * FR-9.2 / PRD §12.3. The business is defaulted to NOT VAT registered, because
 * charging tax you cannot collect is unlawful and has to be refunded, while
 * omitting tax you owe is a correctable filing matter.
 *
 * What these tests protect is that switching it on is a settings change: no
 * rate, no threshold and no category list is written in code.
 */
describe('VAT', () => {
  it('charges nothing while the business is not registered', () => {
    expect(computeVat([line(1000000)], OFF)).toEqual({
      vatRateBp: 0,
      vatCents: 0,
      vatableCents: 0,
    })
  })

  it('applies the configured rate once enabled, with no code change', () => {
    // 16% of 1,000,000 cents.
    expect(computeVat([line(1000000)], ON)).toMatchObject({
      vatRateBp: 1600,
      vatCents: 160000,
    })
  })

  it('uses whatever rate is configured, not a constant', () => {
    const eight: TaxRule = { ...ON, rateBp: 800 }
    expect(computeVat([line(1000000)], eight).vatCents).toBe(80000)
  })

  it('skips categories marked not vatable', () => {
    const lines = [line(500000, 'flowers', true), line(500000, 'books', false)]
    expect(computeVat(lines, ON)).toMatchObject({ vatableCents: 500000, vatCents: 80000 })
  })

  it('restricts to the listed categories when the rule names any', () => {
    const restricted: TaxRule = { ...ON, appliesToCategoryIds: ['vases'] }
    const lines = [line(400000, 'flowers'), line(600000, 'vases')]
    expect(computeVat(lines, restricted)).toMatchObject({
      vatableCents: 600000,
      vatCents: 96000,
    })
  })

  it('does not tax a free-text line under a restricted rule', () => {
    // A custom arrangement has no category, so it cannot be shown to fall
    // inside the list. Not taxing it is the safe reading.
    const restricted: TaxRule = { ...ON, appliesToCategoryIds: ['vases'] }
    expect(computeVat([line(500000, null)], restricted).vatCents).toBe(0)

    // With no restriction it is taxed like anything else.
    expect(computeVat([line(500000, null)], ON).vatCents).toBe(80000)
  })

  it('reduces the vatable amount in proportion to an order discount', () => {
    // 1,000,000 of which 600,000 is vatable, less a 100,000 discount.
    // The discount is shared pro rata: 60,000 of it lands on the vatable part.
    const lines = [line(400000, 'flowers', false), line(600000, 'vases', true)]
    const result = computeVat(lines, ON, 100000)
    expect(result.vatableCents).toBe(540000)
    expect(result.vatCents).toBe(86400)
  })

  it('charges nothing when the rate is zero, even if enabled', () => {
    expect(computeVat([line(1000000)], { ...ON, rateBp: 0 }).vatCents).toBe(0)
  })

  it('rounds to whole cents, never a fraction', () => {
    // 16% of 3,333 cents is 533.28.
    const result = computeVat([line(3333)], ON)
    expect(Number.isInteger(result.vatCents)).toBe(true)
    expect(result.vatCents).toBe(533)
  })
})
