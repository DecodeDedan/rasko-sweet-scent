import type { SqlDatabase } from '../../data/sqlite/types.js'

/**
 * VAT, per FR-9.2 and FR-5.2.
 *
 * ## The FR-9.2 / PRD §12.3 decision
 *
 * The client has not confirmed whether the business is VAT registered. The
 * default is **not registered, VAT off**, because the two mistakes are not
 * symmetrical: charging VAT you are not registered to collect is unlawful and
 * has to be refunded to every customer, while omitting VAT you owe is a
 * correctable filing matter. Off is the recoverable error.
 *
 * What matters is that turning it on is a settings change and not a code
 * change. `tax_config` carries the rate, the effective date and the categories
 * it applies to; this module reads it. Nothing below is hardcoded.
 *
 * Kenya's standard rate is 16%, seeded as `vat_rate_bp = 1600` and inert while
 * `is_vat_enabled` is false. To switch on:
 *   update tax_config set is_vat_enabled = true where effective_to is null;
 */

export interface TaxRule {
  isEnabled: boolean
  rateBp: number
  /** Empty means every category. */
  appliesToCategoryIds: string[]
}

export interface VatResult {
  vatRateBp: number
  vatCents: number
  /** The portion the rate was applied to, for the document to explain itself. */
  vatableCents: number
}

/** The rule in force on a given date. */
export async function activeTaxRule(
  db: SqlDatabase,
  onDate: string = new Date().toISOString().slice(0, 10),
): Promise<TaxRule> {
  const rows = await db.select<Record<string, unknown>>(
    `SELECT is_vat_enabled, vat_rate_bp, applies_to_category_ids
     FROM tax_config
     WHERE deleted_at IS NULL
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [onDate, onDate],
  )

  const row = rows[0]
  if (!row) return { isEnabled: false, rateBp: 0, appliesToCategoryIds: [] }

  let categories: string[] = []
  try {
    const raw = row['applies_to_category_ids']
    const parsed = raw == null ? [] : JSON.parse(String(raw))
    if (Array.isArray(parsed)) categories = parsed.map(String)
  } catch {
    categories = []
  }

  return {
    isEnabled: Number(row['is_vat_enabled'] ?? 0) !== 0,
    rateBp: Number(row['vat_rate_bp'] ?? 0),
    appliesToCategoryIds: categories,
  }
}

export interface VatLine {
  lineTotalCents: number
  /** Null for a free-text line, which has no catalogue category. */
  categoryId: string | null
  categoryIsVatable: boolean
}

/**
 * Computes VAT for a set of lines.
 *
 * A free-text line has no category, so it cannot be proved to fall inside a
 * restricted list. It is therefore vatable only when the rule applies to
 * everything — the reading that never charges tax on something not shown to be
 * taxable.
 */
export function computeVat(lines: readonly VatLine[], rule: TaxRule, discountCents = 0): VatResult {
  if (!rule.isEnabled || rule.rateBp <= 0) {
    return { vatRateBp: 0, vatCents: 0, vatableCents: 0 }
  }

  const restricted = rule.appliesToCategoryIds.length > 0

  const grossVatable = lines.reduce((sum, line) => {
    if (!line.categoryIsVatable) return sum
    if (restricted) {
      if (!line.categoryId || !rule.appliesToCategoryIds.includes(line.categoryId)) return sum
    }
    return sum + line.lineTotalCents
  }, 0)

  if (grossVatable <= 0) return { vatRateBp: rule.rateBp, vatCents: 0, vatableCents: 0 }

  // An order-level discount reduces the vatable amount in the same proportion
  // it reduces the order, so VAT is charged on what is actually paid.
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
  const share = subtotal > 0 ? grossVatable / subtotal : 0
  const vatable = Math.round(grossVatable - discountCents * share)

  return {
    vatRateBp: rule.rateBp,
    vatCents: Math.round((vatable * rule.rateBp) / 10_000),
    vatableCents: vatable,
  }
}
