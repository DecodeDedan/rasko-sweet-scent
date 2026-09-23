import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import { validateRatesSnapshot } from '../payroll/statutory.js'
import type { StatutoryKind } from '../payroll/statutory.js'

/**
 * Settings, audit and system (FR-9.1 – FR-9.6).
 *
 * This module is where every open question in PRD §12 stops being a developer
 * task. VAT registration, the statutory rates, the M-Pesa and bank details that
 * print on an invoice — all of them are rows here, editable by the owner, so
 * answering one is a settings change rather than a release.
 */

export class SettingsRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsRuleError'
  }
}

/** PRD §3.1: "Users & settings — Full / Limited / No access / No access". */
export function canEditSettings(role: Role): boolean {
  return role === 'owner'
}

/** The manager's "Limited": company profile only, never tax or statutory rates. */
export function canEditCompanyProfile(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

/** FR-9.6: audit log is owner and manager. Accountant and sales have no access. */
export function canSeeAuditLog(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export interface CompanyProfile {
  id: string
  company_name: string
  address: string | null
  phone: string | null
  email: string | null
  kra_pin: string | null
  logo_url: string | null
  is_vat_registered: boolean
  mpesa_paybill: string | null
  mpesa_till: string | null
  bank_details: Record<string, string> | null
  stock_deduction_point: 'order_confirmed' | 'delivered' | null
  update_cost_on_receipt: boolean
}

export interface TaxConfig {
  id: string
  is_vat_enabled: boolean
  vat_rate_bp: number
  effective_from: string
  effective_to: string | null
  applies_to_category_ids: string[] | null
}

export interface StatutoryRate {
  id: string
  kind: StatutoryKind
  effective_from: string
  effective_to: string | null
  config: Record<string, unknown>
}

export interface AuditEntry {
  id: string
  actor_id: string | null
  actorName: string
  actor_role: string | null
  action: string
  entity_table: string
  entity_id: string | null
  changed_fields: string[] | null
  reason: string | null
  occurred_at: string
}

export interface AuditQuery {
  actorId?: string
  action?: string
  entityTable?: string
  from?: string
  to?: string
  limit?: number
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'object') return value as T
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return fallback
  }
}

export class SettingsRepository {
  private readonly company: Repository<Record<string, unknown>>
  private readonly tax: Repository<Record<string, unknown>>
  private readonly rates: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    context: WriteContext,
  ) {
    this.company = new Repository(db, 'company_settings', context)
    this.tax = new Repository(db, 'tax_config', context)
    this.rates = new Repository(db, 'statutory_rates', context)
  }

  // --------------------------------------------------------------- FR-9.1

  async companyProfile(): Promise<CompanyProfile | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      'SELECT * FROM company_settings LIMIT 1',
    )
    const row = rows[0]
    if (!row) return null

    return {
      id: String(row['id']),
      company_name: String(row['company_name'] ?? 'Rasko Sweet Scent'),
      address: (row['address'] as string | null) ?? null,
      phone: (row['phone'] as string | null) ?? null,
      email: (row['email'] as string | null) ?? null,
      kra_pin: (row['kra_pin'] as string | null) ?? null,
      logo_url: (row['logo_url'] as string | null) ?? null,
      is_vat_registered: Number(row['is_vat_registered'] ?? 0) !== 0,
      mpesa_paybill: (row['mpesa_paybill'] as string | null) ?? null,
      mpesa_till: (row['mpesa_till'] as string | null) ?? null,
      bank_details: parseJson<Record<string, string> | null>(row['bank_details'], null),
      stock_deduction_point:
        (row['stock_deduction_point'] as CompanyProfile['stock_deduction_point']) ?? null,
      update_cost_on_receipt: Number(row['update_cost_on_receipt'] ?? 0) !== 0,
    }
  }

  async updateCompanyProfile(patch: Partial<CompanyProfile>): Promise<void> {
    if (!canEditCompanyProfile(this.role)) {
      throw new SettingsRuleError('Only an owner or manager can change the company profile.')
    }

    const current = await this.companyProfile()
    if (!current)
      throw new SettingsRuleError('Company settings have not synced to this device yet.')

    // The table CHECKs this, and an invoice with an unreachable phone number is
    // worse than a refused save.
    if (patch.phone && !/^\+254[17][0-9]{8}$/.test(patch.phone)) {
      throw new SettingsRuleError(
        'Enter the phone as +254 followed by nine digits, for example +254712345678.',
      )
    }

    await this.company.update(current.id, patch)
  }

  // --------------------------------------------------------------- FR-9.2

  async taxConfig(): Promise<TaxConfig | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      'SELECT * FROM tax_config WHERE deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1',
    )
    const row = rows[0]
    if (!row) return null

    return {
      id: String(row['id']),
      is_vat_enabled: Number(row['is_vat_enabled'] ?? 0) !== 0,
      vat_rate_bp: Number(row['vat_rate_bp'] ?? 0),
      effective_from: String(row['effective_from']),
      effective_to: (row['effective_to'] as string | null) ?? null,
      applies_to_category_ids: parseJson<string[] | null>(row['applies_to_category_ids'], null),
    }
  }

  /**
   * Turning VAT on is a legal act, not a preference: charging tax you are not
   * registered to collect has to be refunded to every customer. The company
   * profile must say the business is registered before the switch will move.
   */
  async updateTaxConfig(patch: Partial<TaxConfig>): Promise<void> {
    if (!canEditSettings(this.role)) {
      throw new SettingsRuleError('Only the owner can change tax configuration (FR-9.2).')
    }

    const current = await this.taxConfig()
    if (!current)
      throw new SettingsRuleError('Tax configuration has not synced to this device yet.')

    if (patch.is_vat_enabled === true) {
      const company = await this.companyProfile()
      if (!company?.is_vat_registered) {
        throw new SettingsRuleError(
          'Mark the business as VAT registered in the company profile before enabling VAT.',
        )
      }
      if (!company.kra_pin) {
        throw new SettingsRuleError(
          'A KRA PIN is required on the company profile before enabling VAT.',
        )
      }
    }

    if (patch.vat_rate_bp != null && (patch.vat_rate_bp < 0 || patch.vat_rate_bp > 10_000)) {
      throw new SettingsRuleError('The VAT rate must be between 0% and 100%.')
    }

    await this.tax.update(current.id, patch)
  }

  // --------------------------------------------------------------- FR-9.3

  async statutoryRates(): Promise<StatutoryRate[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM statutory_rates WHERE deleted_at IS NULL
       ORDER BY kind, effective_from DESC`,
    )
    return rows.map((row) => ({
      id: String(row['id']),
      kind: String(row['kind']) as StatutoryKind,
      effective_from: String(row['effective_from']),
      effective_to: (row['effective_to'] as string | null) ?? null,
      config: parseJson<Record<string, unknown>>(row['config'], {}),
    }))
  }

  /**
   * A rate change is a new row with its own effective date, never an edit.
   * Editing in place would retroactively alter every payslip already issued
   * against the old figures; a payroll run snapshots the rates it used, and
   * this is the other half of keeping that snapshot honest.
   */
  async addStatutoryRate(input: {
    id: string
    kind: StatutoryKind
    effectiveFrom: string
    config: Record<string, unknown>
  }): Promise<void> {
    if (!canEditSettings(this.role)) {
      throw new SettingsRuleError('Only the owner can change statutory rates (FR-9.3).')
    }

    const problems = validateRatesSnapshot({ [input.kind]: input.config })
    // Only the problems for this scheme matter; the other three are absent by design.
    const relevant = problems.filter(
      (problem) =>
        !/(rates are missing)/.test(problem) || problem.toLowerCase().includes(input.kind),
    )
    if (relevant.length > 0) {
      throw new SettingsRuleError(relevant.join(' '))
    }

    // Close the outgoing row the day before the new one starts, so there is
    // never a gap and never an overlap.
    const existing = await this.db.select<Record<string, unknown>>(
      `SELECT id FROM statutory_rates
       WHERE kind = ? AND deleted_at IS NULL AND effective_to IS NULL`,
      [input.kind],
    )
    const dayBefore = new Date(Date.parse(`${input.effectiveFrom}T00:00:00.000Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10)

    for (const row of existing) {
      await this.rates.update(String(row['id']), { effective_to: dayBefore })
    }

    await this.rates.insert({
      id: input.id,
      kind: input.kind,
      effective_from: input.effectiveFrom,
      effective_to: null,
      config: input.config,
    })
  }

  // --------------------------------------------------------------- FR-9.6

  async auditLog(query: AuditQuery = {}): Promise<AuditEntry[]> {
    if (!canSeeAuditLog(this.role)) {
      throw new SettingsRuleError(
        'The audit log is visible to the owner and manager only (FR-9.6).',
      )
    }

    const clauses: string[] = []
    const params: unknown[] = []

    if (query.actorId) {
      clauses.push('a.actor_id = ?')
      params.push(query.actorId)
    }
    if (query.action) {
      clauses.push('a.action = ?')
      params.push(query.action)
    }
    if (query.entityTable) {
      clauses.push('a.entity_table = ?')
      params.push(query.entityTable)
    }
    if (query.from) {
      clauses.push('date(a.occurred_at) >= ?')
      params.push(query.from)
    }
    if (query.to) {
      clauses.push('date(a.occurred_at) <= ?')
      params.push(query.to)
    }

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT a.*, COALESCE(p.full_name, 'System') AS actor_name
       FROM audit_log a
       LEFT JOIN profiles p ON p.id = a.actor_id
       ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY a.occurred_at DESC
       LIMIT ?`,
      [...params, query.limit ?? 200],
    )

    return rows.map((row) => ({
      id: String(row['id']),
      actor_id: (row['actor_id'] as string | null) ?? null,
      actorName: String(row['actor_name'] ?? 'System'),
      actor_role: (row['actor_role'] as string | null) ?? null,
      action: String(row['action']),
      entity_table: String(row['entity_table']),
      entity_id: (row['entity_id'] as string | null) ?? null,
      changed_fields: parseJson<string[] | null>(row['changed_fields'], null),
      reason: (row['reason'] as string | null) ?? null,
      occurred_at: String(row['occurred_at']),
    }))
  }

  /** Distinct values for the filter controls, so a filter never offers an empty result. */
  async auditFilters(): Promise<{ actions: string[]; tables: string[] }> {
    // Same guard as auditLog(). Today the local mirror is already empty for a
    // role that cannot pull audit_log, so this returns nothing either way —
    // but relying on that is relying on a pull filter to do an access check.
    if (!canSeeAuditLog(this.role)) {
      throw new SettingsRuleError(
        'The audit log is visible to the owner and manager only (FR-9.6).',
      )
    }

    const actions = await this.db.select<{ action: string }>(
      'SELECT DISTINCT action FROM audit_log ORDER BY action',
    )
    const tables = await this.db.select<{ entity_table: string }>(
      'SELECT DISTINCT entity_table FROM audit_log ORDER BY entity_table',
    )
    return {
      actions: actions.map((row) => row.action),
      tables: tables.map((row) => row.entity_table),
    }
  }

  // --------------------------------------------------------------- FR-9.5

  /**
   * What the owner's system screen shows. `lastSyncedAt` is the newest pull
   * cursor: the last moment this device is known to have been in step with the
   * server, which is the closest thing a device can honestly report about
   * backups it does not itself perform.
   */
  async systemStatus(): Promise<{
    lastSyncedAt: string | null
    pendingWrites: number
    failedWrites: number
    deviceRows: number
  }> {
    const cursor = await this.db.select<{ last: string | null }>(
      'SELECT MAX(last_pulled_at) AS last FROM sync_state',
    )
    const pending = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM outbox')
    const failed = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM outbox_dead')
    const rows = await this.db.select<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM clients) + (SELECT COUNT(*) FROM orders)
            + (SELECT COUNT(*) FROM invoices) + (SELECT COUNT(*) FROM products) AS n`,
    )

    return {
      lastSyncedAt: cursor[0]?.last ?? null,
      pendingWrites: Number(pending[0]?.n ?? 0),
      failedWrites: Number(failed[0]?.n ?? 0),
      deviceRows: Number(rows[0]?.n ?? 0),
    }
  }
}
