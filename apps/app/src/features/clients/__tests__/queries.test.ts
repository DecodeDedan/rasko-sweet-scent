import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { pendingCount } from '../../../data/sync/outbox.js'
import { ClientNotDeletableError, ClientsRepository } from '../clientsRepository.js'
import { CLIENT, OWNER, SALES, seededDatabase } from './fixture.js'

describe('clients queries', () => {
  let db: SqlDatabase
  let asOwner: ClientsRepository
  let asSales: ClientsRepository

  beforeEach(async () => {
    db = await seededDatabase()
    asOwner = new ClientsRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER })
    asSales = new ClientsRepository(db, { role: 'sales', userId: SALES }, { userId: SALES })
  })

  afterEach(async () => {
    await db.close()
  })

  // ------------------------------------------------------------ FR-3.2 search

  it('finds a client by part of the name, case-insensitively', async () => {
    const rows = await asOwner.list({ search: 'menengai' })
    expect(rows.map((r) => r.name)).toEqual(['Menengai Events & Planning'])
  })

  it('finds a client by phone number however it is typed', async () => {
    // Stored as +254712004518. All three of these should reach it.
    for (const term of ['712004518', '+254712004518', '0712 004 518']) {
      const rows = await asOwner.list({ search: term })
      expect(
        rows.map((r) => r.name),
        `searching "${term}"`,
      ).toContain('Lanet Gardens Hotel')
    }
  })

  it('returns nothing for a term that matches neither name nor phone', async () => {
    expect(await asOwner.list({ search: 'zzzz-no-such-client' })).toEqual([])
  })

  it('filters by client type', async () => {
    const rows = await asOwner.list({ type: 'corporate' })
    expect(rows.map((r) => r.name)).toEqual(['Lanet Gardens Hotel', 'Rift Valley Sports Club'])
  })

  it('sorts by name, by outstanding balance, and by recent activity', async () => {
    const byName = await asOwner.list({ sort: 'name' })
    expect(byName[0]?.name).toBe('Grace Wanjiru Kamau')

    const byOutstanding = await asOwner.list({ sort: 'outstanding' })
    expect(byOutstanding[0]?.name).toBe('Menengai Events & Planning')
    expect(byOutstanding[0]?.outstanding).toEqual([{ currency: 'KES', cents: 12750000 }])

    const byRecent = await asOwner.list({ sort: 'recent' })
    // Menengai is the only client with an order, so it has the latest activity.
    expect(byRecent[0]?.name).toBe('Menengai Events & Planning')
  })

  // ------------------------------------------------- FR-3.4 permission denial

  it('shows a sales user only the clients they created', async () => {
    const mine = await asSales.list()
    expect(mine.map((r) => r.name).sort()).toEqual([
      'Mercy Chebet Kiplagat',
      'Peter Otieno Ochieng',
    ])

    // The owner sees all six.
    expect(await asOwner.list()).toHaveLength(6)
  })

  it('denies a sales user a client they did not create, even by direct id', async () => {
    expect(await asSales.findSummary(CLIENT.lanet)).toBeNull()
    expect(await asSales.detail(CLIENT.lanet)).toBeNull()

    // And the same id resolves for the owner, so the null is scope, not absence.
    expect(await asOwner.findSummary(CLIENT.lanet)).not.toBeNull()
  })

  it('keeps the scope when searching', async () => {
    // "Lanet" exists but belongs to the manager.
    expect(await asSales.list({ search: 'Lanet' })).toEqual([])
  })

  // ---------------------------------------------------------- FR-3.3 detail

  it('returns order history, invoice history and recent payments', async () => {
    const detail = await asOwner.detail(CLIENT.lanet)
    expect(detail?.client.name).toBe('Lanet Gardens Hotel')

    expect(detail?.invoices).toHaveLength(1)
    expect(detail?.invoices[0]).toMatchObject({
      invoice_number: 'INV-2026-0002',
      total_cents: 6850000,
      paid_cents: 2000000, // 2,150,000 received less the 150,000 reversal
      balance_cents: 4850000,
    })

    // Both payments appear, including the one that was later reversed —
    // the history is the record of what happened (FR-5.5).
    expect(detail?.payments).toHaveLength(2)
  })

  it('lists a client with no history without failing', async () => {
    const detail = await asOwner.detail(CLIENT.grace)
    expect(detail?.orders).toEqual([])
    expect(detail?.invoices).toEqual([])
    expect(detail?.client.lifetime).toEqual([])
  })

  // ------------------------------------------------- FR-3.5 delete guard

  it('refuses to delete a client who still owes money', async () => {
    await expect(asOwner.softDelete(CLIENT.menengai)).rejects.toBeInstanceOf(
      ClientNotDeletableError,
    )

    // Still present, and nothing was queued for the server.
    expect(await asOwner.findSummary(CLIENT.menengai)).not.toBeNull()
    expect(await pendingCount(db)).toBe(0)
  })

  it('allows deleting a client who owes nothing, and queues it', async () => {
    await asOwner.softDelete(CLIENT.grace)

    expect(await asOwner.findSummary(CLIENT.grace)).toBeNull()
    expect(await pendingCount(db)).toBe(1)

    // Soft delete, never a row removal — a hard delete cannot reach an offline
    // device (NFR-S5).
    const rows = await db.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM clients WHERE id = ?',
      [CLIENT.grace],
    )
    expect(rows[0]?.deleted_at).toBeTruthy()
  })

  it('allows deleting a client whose invoices are fully paid', async () => {
    await expect(asOwner.softDelete(CLIENT.riftValley)).resolves.toBeUndefined()
  })
})
