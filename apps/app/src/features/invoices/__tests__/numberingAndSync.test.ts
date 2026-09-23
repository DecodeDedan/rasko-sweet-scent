import { describe, expect, it } from 'vitest'

import { createDevice } from '../../../data/__tests__/harness.js'
import { MockServer } from '../../../data/__tests__/mockServer.js'
import { InvoicesRepository } from '../invoicesRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const MANAGER = '22222222-2222-4222-8222-222222222222'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'

function repo(device: Awaited<ReturnType<typeof createDevice>>, userId: string) {
  return new InvoicesRepository(device.db, { role: 'owner', userId }, { userId })
}

async function seedShared(server: MockServer) {
  server.seed('clients', {
    id: CLIENT,
    name: 'Lanet Gardens Hotel',
    client_type: 'corporate',
    credit_terms_days: 30,
    deleted_at: null,
  })
}

/** An invoice written straight into the local mirror, ready to be issued. */
async function draftInvoice(
  device: Awaited<ReturnType<typeof createDevice>>,
  id: string,
  total: number,
  userId: string,
) {
  await device.db.execute(
    `INSERT INTO invoices (id, client_id, invoice_number, status, issue_date, due_date,
                           subtotal_cents, total_cents, client_snapshot, company_snapshot,
                           created_by, created_at, updated_at, sync_status)
     VALUES (?, ?, NULL, 'draft', '2026-09-04', '2026-10-04', ?, ?, '{}', '{}', ?,
             '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', 'pending')`,
    [id, CLIENT, total, total, userId],
  )
  await device.db.execute(
    `INSERT INTO outbox (entity_table, entity_id, op, payload, created_at)
     VALUES ('invoices', ?, 'insert', ?, '2026-09-04T00:00:00.000Z')`,
    [
      id,
      JSON.stringify({
        id,
        client_id: CLIENT,
        invoice_number: null,
        status: 'draft',
        issue_date: '2026-09-04',
        due_date: '2026-10-04',
        subtotal_cents: total,
        total_cents: total,
        client_snapshot: {},
        company_snapshot: {},
        created_by: userId,
        created_at: '2026-09-04T00:00:00.000Z',
        updated_at: '2026-09-04T00:00:00.000Z',
        deleted_at: null,
      }),
    ],
  )
}

/**
 * FR-5.1 — gap-free, sequential, never reused, across devices that were offline.
 *
 * The device never invents a number. It issues the invoice with `invoice_number`
 * still null and the server allocates from its per-year counter when the row
 * arrives (architecture.md §8.2). That is the only place that can be gap-free
 * across devices, because no offline device can know what the others have taken.
 */
describe('invoice numbering across devices', () => {
  it('gives two invoices issued offline on different devices distinct consecutive numbers', async () => {
    const server = new MockServer()
    await seedShared(server)

    const phone = await createDevice(server, OWNER)
    const desktop = await createDevice(server, MANAGER)
    await phone.sync()
    await desktop.sync()

    // Both go offline and each issues an invoice.
    server.setOffline(true)

    const phoneInvoice = 'b0000000-0000-4000-8000-000000000001'
    const desktopInvoice = 'b0000000-0000-4000-8000-000000000002'
    await draftInvoice(phone, phoneInvoice, 500000, OWNER)
    await draftInvoice(desktop, desktopInvoice, 750000, MANAGER)

    await repo(phone, OWNER).issue(phoneInvoice)
    await repo(desktop, MANAGER).issue(desktopInvoice)

    // Neither has a number yet — nothing offline may invent one.
    expect((await repo(phone, OWNER).findSummary(phoneInvoice))?.invoice_number).toBeNull()
    expect((await repo(desktop, MANAGER).findSummary(desktopInvoice))?.invoice_number).toBeNull()

    // Both reconnect.
    server.setOffline(false)
    await phone.sync()
    await desktop.sync()

    const numbers = server.issuedInvoiceNumbers()
    expect(numbers).toHaveLength(2)
    expect(new Set(numbers).size).toBe(2) // distinct
    expect(numbers).toEqual(['INV-2026-0001', 'INV-2026-0002']) // consecutive, no gap

    // And each device learns its own number on the next pull.
    await phone.sync()
    await desktop.sync()
    const phoneNumber = (await repo(phone, OWNER).findSummary(phoneInvoice))?.invoice_number
    const desktopNumber = (await repo(desktop, MANAGER).findSummary(desktopInvoice))?.invoice_number
    expect(phoneNumber).toBeTruthy()
    expect(desktopNumber).toBeTruthy()
    expect(phoneNumber).not.toBe(desktopNumber)
  })

  it('never reallocates a number when a push is replayed', async () => {
    const server = new MockServer()
    await seedShared(server)
    const device = await createDevice(server, OWNER)
    await device.sync()

    const id = 'b0000000-0000-4000-8000-000000000003'
    await draftInvoice(device, id, 100000, OWNER)
    await repo(device, OWNER).issue(id)
    await device.sync()

    const first = server.issuedInvoiceNumbers()
    expect(first).toEqual(['INV-2026-0001'])

    // Replay the whole cycle twice more, as a retried sync would.
    await device.sync()
    await device.sync()

    expect(server.issuedInvoiceNumbers()).toEqual(first)
    expect(server.count('invoices')).toBe(1)

    await device.close()
  })

  it('leaves a draft unnumbered, so drafts never consume the sequence', async () => {
    const server = new MockServer()
    await seedShared(server)
    const device = await createDevice(server, OWNER)
    await device.sync()

    await draftInvoice(device, 'b0000000-0000-4000-8000-000000000004', 100000, OWNER)
    await device.sync()
    expect(server.issuedInvoiceNumbers()).toEqual([])

    // Issuing it later takes the first number.
    await repo(device, OWNER).issue('b0000000-0000-4000-8000-000000000004')
    await device.sync()
    expect(server.issuedInvoiceNumbers()).toEqual(['INV-2026-0001'])

    await device.close()
  })
})

/** T3 — the same invoice paid offline on two devices. */
describe('T3: concurrent offline payments', () => {
  it('keeps both payments and computes the balance correctly', async () => {
    const server = new MockServer()
    await seedShared(server)
    server.seed('invoices', {
      id: 'b1000000-0000-4000-8000-000000000001',
      client_id: CLIENT,
      invoice_number: 'INV-2026-0001',
      status: 'issued',
      issue_date: '2026-09-01',
      due_date: '2026-10-01',
      subtotal_cents: 1000000,
      total_cents: 1000000,
      client_snapshot: {},
      company_snapshot: {},
      created_by: OWNER,
      deleted_at: null,
    })

    const phone = await createDevice(server, OWNER)
    const desktop = await createDevice(server, MANAGER)
    await phone.sync()
    await desktop.sync()

    const invoiceId = 'b1000000-0000-4000-8000-000000000001'

    // Both take a payment for the same invoice with no connection.
    server.setOffline(true)
    await repo(phone, OWNER).recordPayment({
      id: 'b2000000-0000-4000-8000-000000000001',
      invoiceId,
      amountCents: 400000,
      method: 'mpesa',
      reference: 'SJ61MK22QP',
      paidAt: '2026-09-03T09:00:00.000Z',
      notes: null,
    })
    await repo(desktop, MANAGER).recordPayment({
      id: 'b2000000-0000-4000-8000-000000000002',
      invoiceId,
      amountCents: 350000,
      method: 'cash',
      reference: 'Counter 0142',
      paidAt: '2026-09-03T09:05:00.000Z',
      notes: null,
    })

    // Each device sees only its own so far, and the balance reflects that.
    expect((await repo(phone, OWNER).findSummary(invoiceId))?.balanceCents).toBe(600000)
    expect((await repo(desktop, MANAGER).findSummary(invoiceId))?.balanceCents).toBe(650000)

    server.setOffline(false)
    await phone.sync()
    await desktop.sync()

    // Nothing merged, nothing lost: two independent rows (FR-5.5).
    expect(server.count('payments')).toBe(2)

    // Both devices converge on the same, correct balance.
    await phone.sync()
    await desktop.sync()
    for (const [device, user] of [
      [phone, OWNER],
      [desktop, MANAGER],
    ] as const) {
      const summary = await repo(device, user).findSummary(invoiceId)
      expect(summary?.paidCents).toBe(750000)
      expect(summary?.balanceCents).toBe(250000)
      expect(summary?.derivedStatus).toBe('partially_paid')
    }

    await phone.close()
    await desktop.close()
  })

  it('carries a reversal made offline up on the next sync', async () => {
    const server = new MockServer()
    await seedShared(server)
    server.seed('invoices', {
      id: 'b1000000-0000-4000-8000-000000000002',
      client_id: CLIENT,
      invoice_number: 'INV-2026-0002',
      status: 'issued',
      issue_date: '2026-09-01',
      due_date: '2026-10-01',
      subtotal_cents: 500000,
      total_cents: 500000,
      client_snapshot: {},
      company_snapshot: {},
      created_by: OWNER,
      deleted_at: null,
    })

    const device = await createDevice(server, OWNER)
    await device.sync()
    const invoices = repo(device, OWNER)
    const invoiceId = 'b1000000-0000-4000-8000-000000000002'
    const paymentId = 'b2000000-0000-4000-8000-000000000003'

    server.setOffline(true)
    await invoices.recordPayment({
      id: paymentId,
      invoiceId,
      amountCents: 150000,
      method: 'cash',
      reference: 'Counter 0142',
      paidAt: '2026-09-03T12:00:00.000Z',
      notes: null,
    })
    await invoices.reversePayment({
      id: 'b3000000-0000-4000-8000-000000000001',
      paymentId,
      amountCents: 150000,
      reason: 'Duplicate entry of counter receipt 0142',
    })
    server.setOffline(false)

    await device.sync()

    expect(server.count('payments')).toBe(1)
    expect(server.count('reversals')).toBe(1)
    // The correction is visible as an entry, not as an erased payment.
    expect((await invoices.findSummary(invoiceId))?.balanceCents).toBe(500000)

    await device.close()
  })
})
