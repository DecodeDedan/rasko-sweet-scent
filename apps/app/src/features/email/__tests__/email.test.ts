import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MockServer } from '../../../data/__tests__/mockServer.js'
import { createDevice } from '../../../data/__tests__/harness.js'
import type { Device } from '../../../data/__tests__/harness.js'
import { tableSpec } from '../../../data/sqlite/tables.js'
import { EmailRepository, EmailRuleError } from '../emailRepository.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const SALES = '44444444-4444-4444-8444-444444444444'
const INVOICE = 'a1000000-0000-4000-8000-000000000001'
const PAYMENT = 'b1000000-0000-4000-8000-000000000001'
const EMAIL = 'e1000000-0000-4000-8000-000000000001'

const invoiceDraft = {
  kind: 'invoice' as const,
  toEmail: 'accounts@menengai.example',
  toName: 'Menengai Events',
  clientId: null,
  related: { table: 'invoices' as const, id: INVOICE },
  personalNote: null,
}

describe('client email (migration 20260925000100)', () => {
  let server: MockServer
  let device: Device
  let repo: EmailRepository

  beforeEach(async () => {
    server = new MockServer()
    device = await createDevice(server, OWNER)
    repo = new EmailRepository(device.db, 'owner', { userId: OWNER })
  })

  afterEach(async () => {
    await device.close()
  })

  it('queues an email locally, with no network, and pushes it on sync', async () => {
    server.setOffline(true)
    await repo.queue(EMAIL, invoiceDraft)

    const [local] = await repo.historyFor('invoices', INVOICE)
    expect(local?.status).toBe('queued')
    expect(await device.pending()).toBe(1)

    server.setOffline(false)
    await device.sync()
    expect(server.rows('outbound_emails').map((row) => row['id'])).toEqual([EMAIL])
  })

  it('never lets a retried push overwrite the status the server recorded', async () => {
    await repo.queue(EMAIL, invoiceDraft)
    await device.sync()

    // The server sends it; then the device retries the same push, as it would
    // after a response lost to a dropped connection (T6).
    const [sent] = server.rows('outbound_emails')
    server.seed('outbound_emails', { ...sent, status: 'sent', attempts: 1 })
    await device.remote.push('outbound_emails', [{ ...sent, status: 'queued', attempts: 0 }], {
      appendOnly: tableSpec('outbound_emails').pushInsertOnly === true,
    })
    expect(server.rows('outbound_emails')[0]?.['status']).toBe('sent')

    // And the device learns it was sent.
    await device.sync()
    const [local] = await repo.historyFor('invoices', INVOICE)
    expect(local?.status).toBe('sent')
  })

  it('shows receipts in the invoice history', async () => {
    await device.db.execute(
      `INSERT INTO payments (id, invoice_id, amount_cents, method, paid_at, received_by,
                             created_at, created_by, sync_status)
       VALUES (?, ?, 5000, 'mpesa', '2026-09-20T09:00:00.000Z', ?, '2026-09-20T09:00:00.000Z', ?, 'synced')`,
      [PAYMENT, INVOICE, OWNER, OWNER],
    )
    await repo.queue(EMAIL, {
      ...invoiceDraft,
      kind: 'receipt',
      related: { table: 'payments', id: PAYMENT },
    })

    const history = await repo.historyFor('invoices', INVOICE)
    expect(history.map((email) => email.template_key)).toEqual(['receipt'])
  })

  it('refuses a malformed address, an empty message and a record email with no record', async () => {
    await expect(repo.queue(EMAIL, { ...invoiceDraft, toEmail: 'not-an-address' })).rejects.toThrow(
      /valid email/,
    )
    await expect(
      repo.queue(EMAIL, { ...invoiceDraft, kind: 'message', related: null, personalNote: '  ' }),
    ).rejects.toThrow(/write the message/i)
    await expect(repo.queue(EMAIL, { ...invoiceDraft, related: null })).rejects.toBeInstanceOf(
      EmailRuleError,
    )
    expect(await device.pending()).toBe(0)
  })

  it('lets only the owner or a manager change email wording', async () => {
    const sales = new EmailRepository(device.db, 'sales', { userId: SALES })
    await expect(
      sales.updateTemplate('t1', { subject: 'x', heading: 'y', body: 'z' }),
    ).rejects.toThrow(/manager or the owner/)
  })
})
