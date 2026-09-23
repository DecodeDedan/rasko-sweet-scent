import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { ClientsRepository } from '../clientsRepository.js'
import { OWNER, seededDatabase } from './fixture.js'

/**
 * Parity between the local SQLite aggregate and the Postgres views.
 *
 * The expected figures below were read out of `client_balances` and the issued
 * invoice totals on a live local Supabase, against the same seed rows the
 * fixture inserts. They are not derived from the SQLite query, so if the two
 * definitions ever drift, this fails.
 *
 * If the Postgres views change on purpose, regenerate these with:
 *   select c.name, b.outstanding_cents from client_balances b
 *     join clients c on c.id = b.client_id order by c.name;
 */
const EXPECTED = [
  { name: 'Grace Wanjiru Kamau', lifetime: 0, outstanding: 0 },
  { name: 'Lanet Gardens Hotel', lifetime: 6850000, outstanding: 4850000 },
  { name: 'Menengai Events & Planning', lifetime: 12750000, outstanding: 12750000 },
  { name: 'Mercy Chebet Kiplagat', lifetime: 0, outstanding: 0 },
  { name: 'Peter Otieno Ochieng', lifetime: 320000, outstanding: 320000 },
  { name: 'Rift Valley Sports Club', lifetime: 3400000, outstanding: 0 },
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
      rows.map((r) => ({
        name: r.name,
        lifetime: r.lifetimeCents,
        outstanding: r.outstandingCents,
      })),
    ).toEqual(EXPECTED)
  })

  it('adds a reversal back, so a reversed payment does not reduce the balance', async () => {
    // Lanet: 6,850,000 invoiced, 2,150,000 paid, 150,000 of that reversed.
    const lanet = (await repo.list()).find((r) => r.name === 'Lanet Gardens Hotel')
    expect(lanet?.outstandingCents).toBe(4850000)
  })

  it('excludes draft invoices from both figures', async () => {
    // Mercy has a 185,000 draft. Nothing is owed until it is issued.
    const mercy = (await repo.list()).find((r) => r.name === 'Mercy Chebet Kiplagat')
    expect(mercy?.lifetimeCents).toBe(0)
    expect(mercy?.outstandingCents).toBe(0)
  })

  it('counts a fully paid invoice toward lifetime value but not outstanding', async () => {
    const rift = (await repo.list()).find((r) => r.name === 'Rift Valley Sports Club')
    expect(rift?.lifetimeCents).toBe(3400000)
    expect(rift?.outstandingCents).toBe(0)
  })
})
