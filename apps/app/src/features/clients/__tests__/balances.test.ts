import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { ClientNotDeletableError, ClientsRepository } from '../clientsRepository.js'
import { CLIENT, OWNER, seededDatabase } from './fixture.js'

/**
 * Parity between the local SQLite aggregate and the Postgres views.
 *
 * The expected figures below were read out of `client_balances` and the issued
 * invoice totals on a live local Supabase, against the same seed rows the
 * fixture inserts. They are not derived from the SQLite query, so if the two
 * definitions ever drift, this fails.
 *
 * Figures are now one amount per currency. The fixture is all shillings, so
 * every number below is unchanged from the single-currency version; a zero
 * figure is an empty list because `totalsByCurrency` drops zeroes.
 *
 * If the Postgres views change on purpose, regenerate these with:
 *   select c.name, b.currency, b.outstanding_cents from client_balances b
 *     join clients c on c.id = b.client_id order by c.name, b.currency;
 */
const kes = (cents: number) => (cents === 0 ? [] : [{ currency: 'KES', cents }])

const EXPECTED = [
  { name: 'Grace Wanjiru Kamau', lifetime: kes(0), outstanding: kes(0) },
  { name: 'Lanet Gardens Hotel', lifetime: kes(6850000), outstanding: kes(4850000) },
  { name: 'Menengai Events & Planning', lifetime: kes(12750000), outstanding: kes(12750000) },
  { name: 'Mercy Chebet Kiplagat', lifetime: kes(0), outstanding: kes(0) },
  { name: 'Peter Otieno Ochieng', lifetime: kes(320000), outstanding: kes(320000) },
  { name: 'Rift Valley Sports Club', lifetime: kes(3400000), outstanding: kes(0) },
]

describe('client balances match the Postgres views', () => {
  let db: SqlDatabase
  let repo: ClientsRepository

  beforeEach(async () => {
    db = await seededDatabase()
    repo = new ClientsRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER })
  })

  afterEach(async () => {
    await db.close()
  })

  it('produces the same outstanding and lifetime figures', async () => {
    const rows = await repo.list({ sort: 'name' })

    expect(
      rows.map((r) => ({ name: r.name, lifetime: r.lifetime, outstanding: r.outstanding })),
    ).toEqual(EXPECTED)
  })

  it('adds a reversal back, so a reversed payment does not reduce the balance', async () => {
    // Lanet: 6,850,000 invoiced, 2,150,000 paid, 150,000 of that reversed.
    const lanet = (await repo.list()).find((r) => r.name === 'Lanet Gardens Hotel')
    expect(lanet?.outstanding).toEqual(kes(4850000))
  })

  it('excludes draft invoices from both figures', async () => {
    // Mercy has a 185,000 draft. Nothing is owed until it is issued.
    const mercy = (await repo.list()).find((r) => r.name === 'Mercy Chebet Kiplagat')
    expect(mercy?.lifetime).toEqual([])
    expect(mercy?.outstanding).toEqual([])
  })

  it('counts a fully paid invoice toward lifetime value but not outstanding', async () => {
    const rift = (await repo.list()).find((r) => r.name === 'Rift Valley Sports Club')
    expect(rift?.lifetime).toEqual(kes(3400000))
    expect(rift?.outstanding).toEqual([])
  })
})

describe('client balances never add currencies together', () => {
  let db: SqlDatabase
  let repo: ClientsRepository

  const USD_INVOICE = '80000000-0000-4000-8000-0000000000a1'
  const LEGACY_INVOICE = '80000000-0000-4000-8000-0000000000a2'

  async function invoice(id: string, currency: string | null, total: number) {
    await db.execute(
      `INSERT INTO invoices (id, client_id, invoice_number, status, issue_date, due_date,
                             total_cents, currency, created_at, updated_at, sync_status)
       VALUES (?, ?, NULL, 'issued', '2026-09-10', '2026-09-20', ?, ?,
               '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z', 'synced')`,
      [id, CLIENT.grace, total, currency],
    )
  }

  async function pay(id: string, invoiceId: string, amount: number) {
    await db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, paid_at, received_by,
                             created_at, sync_status)
       VALUES (?, ?, ?, 'bank_transfer', '2026-09-12T08:00:00.000Z', ?,
               '2026-09-12T08:00:00.000Z', 'synced')`,
      [id, invoiceId, amount, OWNER],
    )
  }

  beforeEach(async () => {
    db = await seededDatabase()
    repo = new ClientsRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER })
    // Grace: a dollar invoice and a shilling one written before the column
    // existed (NULL currency, which is shillings).
    await invoice(USD_INVOICE, 'USD', 10800)
    await invoice(LEGACY_INVOICE, null, 1260000)
  })

  afterEach(async () => {
    await db.close()
  })

  it('shows one figure per currency, counting a NULL currency as shillings', async () => {
    const grace = await repo.findSummary(CLIENT.grace)
    const both = [
      { currency: 'KES', cents: 1260000 },
      { currency: 'USD', cents: 10800 },
    ]
    expect(grace?.lifetime).toEqual(both)
    expect(grace?.outstanding).toEqual(both)
  })

  it('reduces only the dollar figure when a dollar invoice is paid', async () => {
    await pay('90000000-0000-4000-8000-0000000000a1', USD_INVOICE, 8000)

    const grace = await repo.findSummary(CLIENT.grace)
    expect(grace?.outstanding).toEqual([
      { currency: 'KES', cents: 1260000 },
      { currency: 'USD', cents: 2800 },
    ])

    const detail = await repo.detail(CLIENT.grace)
    expect(detail?.payments[0]).toMatchObject({ amount_cents: 8000, currency: 'USD' })
    expect(detail?.invoices.find((i) => i.id === LEGACY_INVOICE)?.currency).toBe('KES')
  })

  it('refuses to delete while only the dollar balance is open', async () => {
    await pay('90000000-0000-4000-8000-0000000000a2', LEGACY_INVOICE, 1260000)

    const attempt = repo.softDelete(CLIENT.grace)
    await expect(attempt).rejects.toBeInstanceOf(ClientNotDeletableError)
    await expect(attempt).rejects.toMatchObject({
      outstanding: [{ currency: 'USD', cents: 10800 }],
      message: 'This client still owes USD 108.00 on issued invoices.',
    })
  })

  it('sorts by shillings owed first, then by how many other currencies are owed', async () => {
    // Pay off Grace's shillings: she now owes only dollars, so she ranks after
    // every client owing shillings but before those owing nothing.
    await pay('90000000-0000-4000-8000-0000000000a3', LEGACY_INVOICE, 1260000)

    const names = (await repo.list({ sort: 'outstanding' })).map((r) => r.name)
    expect(names).toEqual([
      'Menengai Events & Planning',
      'Lanet Gardens Hotel',
      'Peter Otieno Ochieng',
      'Grace Wanjiru Kamau',
      'Mercy Chebet Kiplagat',
      'Rift Valley Sports Club',
    ])
  })
})
