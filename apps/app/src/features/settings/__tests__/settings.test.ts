import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import type { Role } from '../../../auth/session.js'
import { SettingsRepository, SettingsRuleError } from '../settingsRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-09-16T09:00:00.000Z'
const SETTINGS_ID = '00000000-0000-0000-0000-000000000001'
const TAX_ID = '7a000000-0000-4000-8000-000000000001'

let db: SqlDatabase

async function seed(): Promise<SqlDatabase> {
  const database = openNodeDatabase()
  await migrateLocalSchema(database)

  await database.execute(
    `INSERT INTO company_settings (id, company_name, is_vat_registered, update_cost_on_receipt,
                                   stock_deduction_point, created_at, updated_at, sync_status)
     VALUES (?, 'Rasko Sweet Scent', 0, 0, 'delivered', ?, ?, 'synced')`,
    [SETTINGS_ID, NOW, NOW],
  )

  await database.execute(
    `INSERT INTO tax_config (id, is_vat_enabled, vat_rate_bp, effective_from,
                             created_at, updated_at, sync_status)
     VALUES (?, 0, 1600, '2026-01-01', ?, ?, 'synced')`,
    [TAX_ID, NOW, NOW],
  )

  await database.execute(
    `INSERT INTO statutory_rates (id, kind, effective_from, config, created_at, updated_at, sync_status)
     VALUES ('5a000000-0000-4000-8000-000000000002', 'nssf', '2026-01-01', ?, ?, ?, 'synced')`,
    [
      JSON.stringify({ tier_1_cap_cents: 800_000, tier_2_cap_cents: 7_200_000, rate_bp: 600 }),
      NOW,
      NOW,
    ],
  )

  return database
}

function repoFor(database: SqlDatabase, role: Role = 'owner'): SettingsRepository {
  return new SettingsRepository(database, role, { userId: OWNER })
}

beforeEach(async () => {
  db = await seed()
})

describe('company profile (FR-9.1)', () => {
  it('saves the details that print on an invoice', async () => {
    const repo = repoFor(db)
    await repo.updateCompanyProfile({
      mpesa_paybill: '247247',
      bank_details: { Bank: 'Equity', Account: '1234567890' },
      kra_pin: 'P051234567X',
    })

    const profile = await repo.companyProfile()
    expect(profile?.mpesa_paybill).toBe('247247')
    expect(profile?.bank_details?.['Bank']).toBe('Equity')
  })

  it('rejects a phone the database CHECK would refuse', async () => {
    const repo = repoFor(db)
    await expect(repo.updateCompanyProfile({ phone: '0712345678' })).rejects.toThrow(/\+254/)
    await expect(repo.updateCompanyProfile({ phone: '+254712345678' })).resolves.toBeUndefined()
  })

  it('lets a manager edit the profile but not tax', async () => {
    const manager = repoFor(db, 'manager')
    await expect(manager.updateCompanyProfile({ address: 'Nakuru' })).resolves.toBeUndefined()
    await expect(manager.updateTaxConfig({ vat_rate_bp: 1600 })).rejects.toThrow(SettingsRuleError)
  })

  it('keeps an accountant out of settings entirely', async () => {
    const accountant = repoFor(db, 'accountant')
    await expect(accountant.updateCompanyProfile({ address: 'Nakuru' })).rejects.toThrow(
      SettingsRuleError,
    )
  })
})

describe('VAT (FR-9.2)', () => {
  it('refuses to enable VAT before the business is marked registered', async () => {
    const repo = repoFor(db)
    await expect(repo.updateTaxConfig({ is_vat_enabled: true })).rejects.toThrow(/VAT registered/i)
  })

  it('refuses to enable VAT without a KRA PIN', async () => {
    const repo = repoFor(db)
    await repo.updateCompanyProfile({ is_vat_registered: true })

    await expect(repo.updateTaxConfig({ is_vat_enabled: true })).rejects.toThrow(/KRA PIN/i)
  })

  it('enables VAT once registration and PIN are both present', async () => {
    const repo = repoFor(db)
    await repo.updateCompanyProfile({ is_vat_registered: true, kra_pin: 'P051234567X' })
    await repo.updateTaxConfig({ is_vat_enabled: true })

    expect((await repo.taxConfig())?.is_vat_enabled).toBe(true)
  })

  it('rejects an impossible rate', async () => {
    const repo = repoFor(db)
    await expect(repo.updateTaxConfig({ vat_rate_bp: 20_000 })).rejects.toThrow(
      /between 0% and 100%/,
    )
  })
})

describe('statutory rates (FR-9.3)', () => {
  it('adds a new row and closes the old one the day before', async () => {
    const repo = repoFor(db)
    await repo.addStatutoryRate({
      id: crypto.randomUUID(),
      kind: 'nssf',
      effectiveFrom: '2027-01-01',
      config: { tier_1_cap_cents: 900_000, tier_2_cap_cents: 8_000_000, rate_bp: 600 },
    })

    const rates = (await repo.statutoryRates()).filter((rate) => rate.kind === 'nssf')
    expect(rates).toHaveLength(2)

    const previous = rates.find((rate) => rate.effective_from === '2026-01-01')
    const current = rates.find((rate) => rate.effective_from === '2027-01-01')

    expect(previous?.effective_to).toBe('2026-12-31')
    expect(current?.effective_to).toBeNull()
  })

  it('never edits history in place', async () => {
    const repo = repoFor(db)
    const before = (await repo.statutoryRates()).find((rate) => rate.kind === 'nssf')

    await repo.addStatutoryRate({
      id: crypto.randomUUID(),
      kind: 'nssf',
      effectiveFrom: '2027-01-01',
      config: { tier_1_cap_cents: 900_000, tier_2_cap_cents: 8_000_000, rate_bp: 600 },
    })

    const after = (await repo.statutoryRates()).find((rate) => rate.id === before?.id)
    expect(after?.config).toEqual(before?.config)
  })

  it('rejects an inverted NSSF configuration', async () => {
    const repo = repoFor(db)
    await expect(
      repo.addStatutoryRate({
        id: crypto.randomUUID(),
        kind: 'nssf',
        effectiveFrom: '2027-01-01',
        config: { tier_1_cap_cents: 900_000, tier_2_cap_cents: 100_000, rate_bp: 600 },
      }),
    ).rejects.toThrow(SettingsRuleError)
  })

  it('lets only the owner change rates', async () => {
    const manager = repoFor(db, 'manager')
    await expect(
      manager.addStatutoryRate({
        id: crypto.randomUUID(),
        kind: 'nssf',
        effectiveFrom: '2027-01-01',
        config: { tier_1_cap_cents: 900_000, tier_2_cap_cents: 8_000_000, rate_bp: 600 },
      }),
    ).rejects.toThrow(SettingsRuleError)
  })
})

describe('audit log (FR-9.6)', () => {
  beforeEach(async () => {
    const entry = async (action: string, table: string, occurredAt: string) =>
      db.execute(
        `INSERT INTO audit_log (id, actor_id, actor_role, action, entity_table, entity_id,
                                occurred_at, recorded_at, sync_status)
         VALUES (?, ?, 'owner', ?, ?, ?, ?, ?, 'synced')`,
        [crypto.randomUUID(), OWNER, action, table, crypto.randomUUID(), occurredAt, occurredAt],
      )

    await entry('delete', 'clients', '2026-09-16T08:00:00.000Z')
    await entry('payment', 'payments', '2026-09-15T08:00:00.000Z')
    await entry('role_change', 'profiles', '2026-08-01T08:00:00.000Z')
  })

  it('returns entries newest first', async () => {
    const entries = await repoFor(db).auditLog()
    expect(entries).toHaveLength(3)
    expect(entries[0]?.action).toBe('delete')
  })

  it('filters by action, table and date range', async () => {
    const repo = repoFor(db)
    expect(await repo.auditLog({ action: 'payment' })).toHaveLength(1)
    expect(await repo.auditLog({ entityTable: 'profiles' })).toHaveLength(1)
    expect(await repo.auditLog({ from: '2026-09-01' })).toHaveLength(2)
    expect(await repo.auditLog({ from: '2026-09-01', to: '2026-09-15' })).toHaveLength(1)
  })

  it('is refused to an accountant and to sales', async () => {
    await expect(repoFor(db, 'accountant').auditLog()).rejects.toThrow(SettingsRuleError)
    await expect(repoFor(db, 'sales').auditLog()).rejects.toThrow(SettingsRuleError)
  })

  it('offers only filter values that exist', async () => {
    const filters = await repoFor(db).auditFilters()
    expect(filters.actions).toEqual(['delete', 'payment', 'role_change'])
    expect(filters.tables).toEqual(['clients', 'payments', 'profiles'])
  })
})

describe('system status (FR-9.5)', () => {
  it('reports the last sync and anything still queued', async () => {
    await db.execute(
      `INSERT INTO sync_state (table_name, cursor_updated_at, cursor_id, last_pulled_at)
       VALUES ('clients', ?, ?, ?)`,
      [NOW, crypto.randomUUID(), NOW],
    )

    const status = await repoFor(db).systemStatus()
    expect(status.lastSyncedAt).toBe(NOW)
    expect(status.pendingWrites).toBe(0)
    expect(status.failedWrites).toBe(0)
  })
})
