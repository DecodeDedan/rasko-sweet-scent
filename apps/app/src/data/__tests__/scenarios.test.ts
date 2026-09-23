import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { deadCount } from '../sync/outbox.js'
import { createDevice, id, restartDevice } from './harness.js'
import { MockServer } from './mockServer.js'

/**
 * PRD §6 test scenarios T1–T6. "All must pass before go-live."
 *
 * Two independent devices, each with a real SQLite database and its own outbox
 * and cursors, against one shared mock server.
 */

const OWNER = '11111111-1111-4111-8111-111111111111'
const SALES = '44444444-4444-4444-8444-444444444444'

let server: MockServer
const scratch = mkdtempSync(join(tmpdir(), 'rasko-sync-'))

beforeEach(() => {
  server = new MockServer()
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

// ---------------------------------------------------------------- T1

describe('T1 — an order created offline reaches the server and the other device', () => {
  it('syncs a write made with no connection', async () => {
    const phone = await createDevice(server, SALES)
    const desktop = await createDevice(server, OWNER)

    // Airplane mode.
    server.setOffline(true)

    const orderId = id('a0000001')
    await phone.repo('orders').insert({
      id: orderId,
      status: 'draft',
      is_walk_in: true,
      taken_by: SALES,
      total_cents: 450000,
      notes: 'Written with no connection',
    })

    // The write is on the device immediately — the UI never waited.
    expect(await phone.repo('orders').findById(orderId)).toMatchObject({
      total_cents: 450000,
    })
    expect(await phone.pending()).toBe(1)

    // Syncing while offline changes nothing and loses nothing.
    const offlineAttempt = await phone.sync()
    expect(offlineAttempt.error).toBeTruthy()
    expect(await phone.pending()).toBe(1)
    expect(server.count('orders')).toBe(0)

    // Reconnect.
    server.setOffline(false)
    const outcome = await phone.sync()

    expect(outcome.error).toBeNull()
    expect(outcome.pushed).toBe(1)
    expect(await phone.pending()).toBe(0)
    expect(server.count('orders')).toBe(1)

    // And it appears on the owner's device.
    await desktop.sync()
    const seen = await desktop.repo('orders').findById(orderId)
    expect(seen).toMatchObject({ total_cents: 450000, notes: 'Written with no connection' })

    await phone.close()
    await desktop.close()
  })

  it('marks the row synced once it lands', async () => {
    const phone = await createDevice(server, SALES)
    const orderId = id('a0000002')

    await phone.repo('orders').insert({ id: orderId, status: 'draft', taken_by: SALES })
    const before = await phone.db.select<{ sync_status: string }>(
      'SELECT sync_status FROM orders WHERE id = ?',
      [orderId],
    )
    expect(before[0]?.sync_status).toBe('pending')

    await phone.sync()
    const after = await phone.db.select<{ sync_status: string }>(
      'SELECT sync_status FROM orders WHERE id = ?',
      [orderId],
    )
    expect(after[0]?.sync_status).toBe('synced')

    await phone.close()
  })
})

// ---------------------------------------------------------------- T2

describe('T2 — the same record edited on two devices offline resolves deterministically', () => {
  it('converges both devices on the write that reached the server last', async () => {
    const phone = await createDevice(server, SALES)
    const desktop = await createDevice(server, OWNER)

    const clientId = id('b0000001')
    server.seed('clients', {
      id: clientId,
      name: 'Lanet Gardens Hotel',
      client_type: 'corporate',
      credit_terms_days: 30,
      created_at: '2026-08-01T00:00:00.000Z',
      deleted_at: null,
    })

    await phone.sync()
    await desktop.sync()

    // Both go offline and edit the same field.
    server.setOffline(true)
    await phone.repo('clients').update(clientId, { credit_terms_days: 7 })
    await desktop.repo('clients').update(clientId, { credit_terms_days: 45 })
    server.setOffline(false)

    // The phone reaches the server first, then the desktop.
    await phone.sync()
    await desktop.sync()

    // NFR-S4: server wins, and the last push to arrive is the server's state.
    expect(server.rows('clients')[0]).toMatchObject({ credit_terms_days: 45 })

    // Both devices converge on it. The phone's value is replaced on its next pull.
    await phone.sync()
    expect(await phone.repo('clients').findById(clientId)).toMatchObject({
      credit_terms_days: 45,
    })
    expect(await desktop.repo('clients').findById(clientId)).toMatchObject({
      credit_terms_days: 45,
    })

    await phone.close()
    await desktop.close()
  })

  it('does not let a pull clobber a local edit that has not been pushed', async () => {
    const phone = await createDevice(server, SALES)
    const clientId = id('b0000002')

    server.seed('clients', { id: clientId, name: 'Original', deleted_at: null })
    await phone.sync()

    // Someone else changes it on the server.
    server.seed('clients', { id: clientId, name: 'Changed elsewhere', deleted_at: null })

    // Meanwhile this device edits it while offline.
    server.setOffline(true)
    await phone.repo('clients').update(clientId, { name: 'Edited here' })
    server.setOffline(false)

    await phone.sync()

    // Push ran first, so this device's edit reached the server and won.
    expect(await phone.repo('clients').findById(clientId)).toMatchObject({ name: 'Edited here' })
    expect(server.rows('clients')[0]).toMatchObject({ name: 'Edited here' })

    await phone.close()
  })
})

// ---------------------------------------------------------------- T3

describe('T3 — two offline payments against one invoice both survive', () => {
  it('keeps both payments and computes the balance correctly', async () => {
    const phone = await createDevice(server, SALES)
    const desktop = await createDevice(server, OWNER)

    const invoiceId = id('c0000001')
    server.seed('invoices', {
      id: invoiceId,
      invoice_number: 'INV-2026-0001',
      status: 'issued',
      total_cents: 1000000,
      deleted_at: null,
    })
    await phone.sync()
    await desktop.sync()

    // Both take a payment for the same invoice with no connection.
    server.setOffline(true)
    await phone.repo('payments').insert({
      id: id('c1000001'),
      invoice_id: invoiceId,
      amount_cents: 400000,
      method: 'mpesa',
      paid_at: '2026-09-01T09:00:00.000Z',
      received_by: SALES,
    })
    await desktop.repo('payments').insert({
      id: id('c1000002'),
      invoice_id: invoiceId,
      amount_cents: 350000,
      method: 'cash',
      paid_at: '2026-09-01T09:05:00.000Z',
      received_by: OWNER,
    })
    server.setOffline(false)

    await phone.sync()
    await desktop.sync()

    // Nothing merged, nothing lost: two independent rows.
    expect(server.count('payments')).toBe(2)

    await phone.sync()
    const paid = await phone
      .repo('payments')
      .raw<{ total: number }>(
        'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE invoice_id = ?',
        [invoiceId],
      )
    expect(paid[0]?.total).toBe(750000)

    // Balance is a sum, so it is right without any merge logic (FR-5.4).
    const invoice = await phone.repo('invoices').findById(invoiceId)
    expect(Number(invoice?.['total_cents']) - Number(paid[0]?.total)).toBe(250000)

    await phone.close()
    await desktop.close()
  })

  it('never overwrites a payment already on the server', async () => {
    const phone = await createDevice(server, SALES)
    const paymentId = id('c2000001')

    await phone.repo('payments').insert({
      id: paymentId,
      invoice_id: id('c2000002'),
      amount_cents: 500000,
      method: 'cash',
      paid_at: '2026-09-01T10:00:00.000Z',
      received_by: SALES,
    })
    await phone.sync()

    // A replayed push of a mutated payload must not change the stored row:
    // append-only tables ignore duplicates (FR-5.5).
    await phone.remote.push(
      'payments',
      [{ id: paymentId, invoice_id: id('c2000003'), amount_cents: 999999, method: 'cash' }],
      { appendOnly: true },
    )

    expect(server.rows('payments')[0]).toMatchObject({ amount_cents: 500000 })
    await phone.close()
  })
})

// ---------------------------------------------------------------- T4

describe('T4 — deactivating a user revokes the device on its next sync', () => {
  it('reports an auth failure rather than silently syncing nothing', async () => {
    const phone = await createDevice(server, SALES)

    await phone.repo('orders').insert({ id: id('d0000001'), status: 'draft', taken_by: SALES })
    await phone.sync()
    expect(server.count('orders')).toBe(1)

    // The owner deactivates them while this device happens to be offline.
    server.setOffline(true)
    server.deactivate(SALES)
    await phone.repo('orders').insert({ id: id('d0000002'), status: 'draft', taken_by: SALES })

    // Still usable locally — nothing can reach the device to tell it otherwise.
    expect(await phone.repo('orders').count()).toBe(2)

    // On reconnect the server refuses it.
    server.setOffline(false)
    const outcome = await phone.sync()

    expect(outcome.authFailed).toBe(true)
    expect(outcome.pushed).toBe(0)
    // The unsent write is kept, not discarded: it may be legitimate work that a
    // reactivated account should still be able to send.
    expect(await phone.pending()).toBe(1)
    expect(server.count('orders')).toBe(1)

    await phone.close()
  })

  it('resumes cleanly once the account is reactivated', async () => {
    const phone = await createDevice(server, SALES)
    server.deactivate(SALES)

    await phone.repo('orders').insert({ id: id('d1000001'), status: 'draft', taken_by: SALES })
    expect((await phone.sync()).authFailed).toBe(true)

    server.reactivate(SALES)
    const outcome = await phone.sync()

    expect(outcome.authFailed).toBe(false)
    expect(outcome.pushed).toBe(1)
    expect(server.count('orders')).toBe(1)

    await phone.close()
  })
})

// ---------------------------------------------------------------- T5

describe('T5 — a restart with no network opens on cached data', () => {
  it('keeps every synced record across a relaunch', async () => {
    const path = join(scratch, 't5.db')

    const first = await createDevice(server, OWNER, { path })
    for (let index = 0; index < 25; index += 1) {
      server.seed('clients', {
        id: id('e0000001'),
        name: `Client ${index}`,
        client_type: 'individual',
        deleted_at: null,
      })
    }
    await first.sync()
    expect(await first.repo('clients').count()).toBe(25)

    // A local write that has not been pushed must also survive the restart —
    // PRD §7: "updates never destroy unsynced local data".
    server.setOffline(true)
    await first.repo('orders').insert({ id: id('e1000001'), status: 'draft', taken_by: OWNER })
    expect(await first.pending()).toBe(1)
    await first.close()

    // Relaunch with no network at all.
    const relaunched = await restartDevice(server, OWNER, path)

    expect(await relaunched.repo('clients').count()).toBe(25)
    expect(await relaunched.repo('orders').count()).toBe(1)
    expect(await relaunched.pending()).toBe(1)

    // And once the network returns, the queued write still goes.
    server.setOffline(false)
    const outcome = await relaunched.sync()
    expect(outcome.pushed).toBe(1)
    expect(server.count('orders')).toBe(1)

    await relaunched.close()
  })

  it('does not re-pull what it already has', async () => {
    const path = join(scratch, 't5-cursor.db')

    const first = await createDevice(server, OWNER, { path })
    for (let index = 0; index < 10; index += 1) {
      server.seed('clients', { id: id('e2000001'), name: `C${index}`, deleted_at: null })
    }
    const initial = await first.sync()
    expect(initial.pulled).toBe(10)
    await first.close()

    // The cursor is on disk, so the next launch resumes rather than restarting.
    const relaunched = await restartDevice(server, OWNER, path)
    const second = await relaunched.sync()
    expect(second.pulled).toBe(0)

    await relaunched.close()
  })
})

// ---------------------------------------------------------------- T6

describe('T6 — 200 orders and payments sync idempotently', () => {
  it('produces no duplicates however many times the cycle runs', async () => {
    const phone = await createDevice(server, SALES)

    server.setOffline(true)
    for (let index = 0; index < 200; index += 1) {
      const orderId = id('f0000001')
      await phone.repo('orders').insert({
        id: orderId,
        status: 'confirmed',
        taken_by: SALES,
        total_cents: 1000 * (index + 1),
      })
      await phone.repo('payments').insert({
        id: id('f1000001'),
        invoice_id: orderId,
        amount_cents: 1000 * (index + 1),
        method: 'mpesa',
        paid_at: '2026-09-01T12:00:00.000Z',
        received_by: SALES,
      })
    }
    expect(await phone.pending()).toBe(400)

    server.setOffline(false)
    const first = await phone.sync()
    expect(first.pushed).toBe(400)
    expect(await phone.pending()).toBe(0)
    expect(server.count('orders')).toBe(200)
    expect(server.count('payments')).toBe(200)

    // Replay the whole cycle twice more.
    await phone.sync()
    await phone.sync()

    expect(server.count('orders')).toBe(200)
    expect(server.count('payments')).toBe(200)
    expect(await phone.repo('orders').count()).toBe(200)
    expect(await phone.repo('payments').count()).toBe(200)
    expect(await deadCount(phone.db)).toBe(0)

    // A second device receives exactly 400 rows, not 800.
    const desktop = await createDevice(server, OWNER)
    await desktop.sync()
    await desktop.sync()
    expect(await desktop.repo('orders').count()).toBe(200)
    expect(await desktop.repo('payments').count()).toBe(200)

    await phone.close()
    await desktop.close()
  })

  it('collapses repeated edits to one queue entry', async () => {
    const phone = await createDevice(server, SALES)
    server.setOffline(true)

    const orderId = id('f2000001')
    await phone.repo('orders').insert({ id: orderId, status: 'draft', taken_by: SALES })
    for (let index = 0; index < 20; index += 1) {
      await phone.repo('orders').update(orderId, { notes: `revision ${index}` })
    }

    // The queue is proportional to changed records, not keystrokes (§9.2).
    expect(await phone.pending()).toBe(1)

    server.setOffline(false)
    await phone.sync()
    expect(server.rows('orders')[0]).toMatchObject({ notes: 'revision 19' })

    await phone.close()
  })
})
