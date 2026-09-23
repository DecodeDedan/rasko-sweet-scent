import { describe, expect, it } from 'vitest'

import { createDevice } from '../../../data/__tests__/harness.js'
import { MockServer } from '../../../data/__tests__/mockServer.js'
import { ClientsRepository } from '../clientsRepository.js'
import { SALES } from './fixture.js'

/**
 * A client created with no connection reaches the server, and the other
 * device, once connectivity returns (PRD §6, T1 applied to this module).
 */
describe('creating a client offline', () => {
  it('saves locally, queues, and syncs when the connection returns', async () => {
    const server = new MockServer()
    const phone = await createDevice(server, SALES)
    const desktop = await createDevice(server, '11111111-1111-4111-8111-111111111111')

    const repo = new ClientsRepository(
      phone.db,
      { role: 'sales', userId: SALES },
      { userId: SALES },
    )

    server.setOffline(true)

    const id = 'aa000000-0000-4000-8000-000000000001'
    await repo.create({
      id,
      name: 'Nakuru Blooms Boutique',
      client_type: 'corporate',
      phone: '+254712345678',
      email: null,
      kra_pin: null,
      address: 'Kenyatta Avenue, Nakuru',
      credit_terms_days: 14,
      notes: null,
    })

    // Visible on the device at once — the UI never waited for the network.
    const local = await repo.list()
    expect(local.map((c) => c.name)).toEqual(['Nakuru Blooms Boutique'])
    expect(await phone.pending()).toBe(1)
    expect(server.count('clients')).toBe(0)

    // Reconnect.
    server.setOffline(false)
    const outcome = await phone.sync()

    expect(outcome.error).toBeNull()
    expect(outcome.pushed).toBe(1)
    expect(await phone.pending()).toBe(0)
    expect(server.count('clients')).toBe(1)
    expect(server.rows('clients')[0]).toMatchObject({
      name: 'Nakuru Blooms Boutique',
      credit_terms_days: 14,
      created_by: SALES,
    })

    // The owner's device receives it on its next sync.
    await desktop.sync()
    const ownerRepo = new ClientsRepository(
      desktop.db,
      { role: 'owner', userId: '11111111-1111-4111-8111-111111111111' },
      { userId: '11111111-1111-4111-8111-111111111111' },
    )
    expect((await ownerRepo.list()).map((c) => c.name)).toEqual(['Nakuru Blooms Boutique'])

    await phone.close()
    await desktop.close()
  })

  it('marks the row pending, then synced', async () => {
    const server = new MockServer()
    const device = await createDevice(server, SALES)
    const repo = new ClientsRepository(
      device.db,
      { role: 'sales', userId: SALES },
      { userId: SALES },
    )

    const id = 'aa000000-0000-4000-8000-000000000002'
    server.setOffline(true)
    await repo.create({
      id,
      name: 'Offline Client',
      client_type: 'individual',
      phone: null,
      email: null,
      kra_pin: null,
      address: null,
      credit_terms_days: 0,
      notes: null,
    })

    const before = await device.db.select<{ sync_status: string }>(
      'SELECT sync_status FROM clients WHERE id = ?',
      [id],
    )
    expect(before[0]?.sync_status).toBe('pending')

    server.setOffline(false)
    await device.sync()

    const after = await device.db.select<{ sync_status: string }>(
      'SELECT sync_status FROM clients WHERE id = ?',
      [id],
    )
    expect(after[0]?.sync_status).toBe('synced')

    await device.close()
  })

  it('syncs an offline edit and an offline delete', async () => {
    const server = new MockServer()
    const device = await createDevice(server, '11111111-1111-4111-8111-111111111111')
    const repo = new ClientsRepository(
      device.db,
      { role: 'owner', userId: '11111111-1111-4111-8111-111111111111' },
      { userId: '11111111-1111-4111-8111-111111111111' },
    )

    const id = 'aa000000-0000-4000-8000-000000000003'
    await repo.create({
      id,
      name: 'Temporary Client',
      client_type: 'individual',
      phone: null,
      email: null,
      kra_pin: null,
      address: null,
      credit_terms_days: 0,
      notes: null,
    })
    await device.sync()

    server.setOffline(true)
    await repo.update(id, { name: 'Renamed Offline' })
    // No invoices, so nothing blocks the delete (FR-3.5).
    await repo.softDelete(id)
    server.setOffline(false)

    await device.sync()

    // The delete is a soft delete, so the row still syncs (NFR-S5).
    expect(server.count('clients')).toBe(1)
    expect(server.rows('clients')[0]).toMatchObject({ name: 'Renamed Offline' })
    expect(server.rows('clients')[0]?.['deleted_at']).toBeTruthy()

    // And it is gone from the list.
    expect(await repo.list()).toEqual([])

    await device.close()
  })
})
