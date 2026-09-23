/**
 * Kenyan statutory deductions (FR-8.4).
 *
 * Every rate here is **read from `statutory_rates`**, never written as a
 * constant. FR-9.3 and PRD §9 require that: PAYE bands, the NSSF ceilings, the
 * SHIF rate and the Housing Levy all change by legislation, and a business that
 * has to wait for a new build to file correctly is a business that files late.
 *
 * ## The order matters, and it is the part people get wrong
 *
 * Under the Tax Laws (Amendment) Act 2024, NSSF, SHIF and the Housing Levy are
 * **allowable deductions against taxable pay** — they come off gross before PAYE
 * is computed, rather than being reliefs applied after. Computing PAYE on gross
 * overstates tax for every employee, so the sequence below is:
 *
 *   gross → NSSF, SHIF, Housing Levy → taxable → PAYE bands → personal relief
 *
 * Which deductions precede PAYE is itself configurable (`deductions_before_tax`
 * on the PAYE config) so the next amendment is a settings change, not a release.
 */

export type StatutoryKind = 'paye' | 'nssf' | 'shif' | 'housing_levy'

export interface PayeBand {
  /** Upper bound of this band in cents; null means "and everything above". */
  upto_cents: number | null
  /** Basis points — 1000 = 10%. */
  rate_bp: number
}

export interface PayeConfig {
  bands: PayeBand[]
  personal_relief_cents: number
  /** Defaults to current law. Naming fewer here is how an amendment is applied. */
  deductions_before_tax?: Array<'nssf' | 'shif' | 'housing_levy'>
}

export interface NssfConfig {
  tier_1_cap_cents: number
  tier_2_cap_cents: number
  rate_bp: number
}

export interface ShifConfig {
  rate_bp: number
  minimum_cents?: number
}

export interface HousingLevyConfig {
  rate_bp: number
  cap_cents?: number | null
}

export interface RatesSnapshot {
  paye: PayeConfig
  nssf: NssfConfig
  shif: ShifConfig
  housing_levy: HousingLevyConfig
}

export interface Allowance {
  code: string
  label: string
  amount_cents: number
}

export interface OtherDeduction {
  label: string
  amount_cents: number
}

export interface PayrollInput {
  basicPayCents: number
  allowances: readonly Allowance[]
  /** Recovered from approved advances (FR-8.3). */
  advanceDeductionCents?: number
  otherDeductions?: readonly OtherDeduction[]
  /** Daily-rate employees only; monthly staff ignore it. */
  daysWorked?: number
  salaryType?: 'monthly' | 'daily'
}

export interface PayrollResult {
  basicPayCents: number
  allowancesCents: number
  grossCents: number
  nssfCents: number
  shifCents: number
  housingLevyCents: number
  taxablePayCents: number
  payeBeforeReliefCents: number
  payeCents: number
  advanceDeductionCents: number
  otherDeductionsCents: number
  totalDeductionsCents: number
  netPayCents: number
}

const DEFAULT_DEDUCTIBLE: Array<'nssf' | 'shif' | 'housing_levy'> = ['nssf', 'shif', 'housing_levy']

export class PayrollConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollConfigError'
  }
}

/** Rounds to whole cents. Money is integer cents everywhere (PRD §7). */
function applyRate(amountCents: number, rateBp: number): number {
  return Math.round((amountCents * rateBp) / 10_000)
}

/**
 * NSSF is contributed in two tiers, each capped, and the employee pays the same
 * rate on both. Tier 2 applies only to the slice between the two ceilings.
 */
export function computeNssf(grossCents: number, config: NssfConfig): number {
  if (config.tier_2_cap_cents < config.tier_1_cap_cents) {
    throw new PayrollConfigError('The NSSF tier 2 ceiling cannot be below tier 1.')
  }

  const tier1 = Math.min(grossCents, config.tier_1_cap_cents)
  const tier2 = Math.max(0, Math.min(grossCents, config.tier_2_cap_cents) - config.tier_1_cap_cents)

  return applyRate(tier1 + tier2, config.rate_bp)
}

/** A flat rate on gross, with a floor so the lowest-paid still contribute. */
export function computeShif(grossCents: number, config: ShifConfig): number {
  if (grossCents <= 0) return 0
  return Math.max(applyRate(grossCents, config.rate_bp), config.minimum_cents ?? 0)
}

export function computeHousingLevy(grossCents: number, config: HousingLevyConfig): number {
  const levy = applyRate(grossCents, config.rate_bp)
  return config.cap_cents == null ? levy : Math.min(levy, config.cap_cents)
}

/**
 * Marginal banding: each band taxes only the slice of income inside it, so a
 * shilling that crosses a threshold never costs more than it earns.
 */
export function computePayeBeforeRelief(taxableCents: number, config: PayeConfig): number {
  if (config.bands.length === 0) {
    throw new PayrollConfigError('The PAYE configuration has no bands.')
  }
  if (taxableCents <= 0) return 0

  let tax = 0
  let floor = 0

  for (const band of config.bands) {
    const ceiling = band.upto_cents ?? Number.POSITIVE_INFINITY
    if (ceiling <= floor) {
      throw new PayrollConfigError('PAYE bands must ascend; check the band ceilings.')
    }

    const slice = Math.max(0, Math.min(taxableCents, ceiling) - floor)
    if (slice === 0) break

    tax += applyRate(slice, band.rate_bp)
    floor = ceiling
    if (taxableCents <= ceiling) break
  }

  return tax
}

/**
 * The whole monthly computation for one employee, in the order the law applies
 * it. Every intermediate figure is returned because a payslip has to show its
 * working (FR-8.6) and an accountant has to be able to check it by hand.
 */
export function computePayroll(input: PayrollInput, rates: RatesSnapshot): PayrollResult {
  const basic =
    input.salaryType === 'daily'
      ? Math.round(input.basicPayCents * (input.daysWorked ?? 0))
      : input.basicPayCents

  if (basic < 0) throw new PayrollConfigError('Basic pay cannot be negative.')

  const allowancesCents = input.allowances.reduce(
    (sum, allowance) => sum + Math.max(0, allowance.amount_cents),
    0,
  )
  const gross = basic + allowancesCents

  const nssf = computeNssf(gross, rates.nssf)
  const shif = computeShif(gross, rates.shif)
  const housingLevy = computeHousingLevy(gross, rates.housing_levy)

  const deductible = rates.paye.deductions_before_tax ?? DEFAULT_DEDUCTIBLE
  const preTax =
    (deductible.includes('nssf') ? nssf : 0) +
    (deductible.includes('shif') ? shif : 0) +
    (deductible.includes('housing_levy') ? housingLevy : 0)

  const taxable = Math.max(0, gross - preTax)
  const payeBeforeRelief = computePayeBeforeRelief(taxable, rates.paye)

  // Personal relief cannot create a refund — PAYE floors at zero.
  const paye = Math.max(0, payeBeforeRelief - rates.paye.personal_relief_cents)

  const advance = Math.max(0, input.advanceDeductionCents ?? 0)
  const other = (input.otherDeductions ?? []).reduce(
    (sum, deduction) => sum + Math.max(0, deduction.amount_cents),
    0,
  )

  const totalDeductions = paye + nssf + shif + housingLevy + advance + other

  return {
    basicPayCents: basic,
    allowancesCents,
    grossCents: gross,
    nssfCents: nssf,
    shifCents: shif,
    housingLevyCents: housingLevy,
    taxablePayCents: taxable,
    payeBeforeReliefCents: payeBeforeRelief,
    payeCents: paye,
    advanceDeductionCents: advance,
    otherDeductionsCents: other,
    totalDeductionsCents: totalDeductions,
    // May go negative if deductions exceed gross — surfaced, never silently
    // clamped, because a negative net pay is a data problem someone must fix.
    netPayCents: gross - totalDeductions,
  }
}

/** Validates a config before it is saved (FR-9.3), so a bad rate never reaches a payslip. */
export function validateRatesSnapshot(snapshot: Partial<RatesSnapshot>): string[] {
  const problems: string[] = []

  if (!snapshot.paye) problems.push('PAYE rates are missing.')
  else {
    if (!Array.isArray(snapshot.paye.bands) || snapshot.paye.bands.length === 0) {
      problems.push('PAYE needs at least one band.')
    } else {
      let previous = 0
      for (const band of snapshot.paye.bands) {
        const ceiling = band.upto_cents ?? Number.POSITIVE_INFINITY
        if (ceiling <= previous) problems.push('PAYE bands must ascend.')
        if (band.rate_bp < 0 || band.rate_bp > 10_000) {
          problems.push('A PAYE band rate must be between 0% and 100%.')
        }
        previous = ceiling
      }
      if (snapshot.paye.bands[snapshot.paye.bands.length - 1]?.upto_cents !== null) {
        problems.push('The top PAYE band must be open-ended (upto_cents null).')
      }
    }
    if ((snapshot.paye.personal_relief_cents ?? -1) < 0) {
      problems.push('Personal relief cannot be negative.')
    }
  }

  if (!snapshot.nssf) problems.push('NSSF rates are missing.')
  else if (snapshot.nssf.tier_2_cap_cents < snapshot.nssf.tier_1_cap_cents) {
    problems.push('The NSSF tier 2 ceiling cannot be below tier 1.')
  }

  if (!snapshot.shif) problems.push('SHIF rates are missing.')
  if (!snapshot.housing_levy) problems.push('Housing Levy rates are missing.')

  return problems
}
