import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { InvoiceRuleError, InvoicesRepository } from '../invoicesRepository.js'
import { INVOICE, MANAGER, OWNER, SALES, TODAY, seededDatabase } from './fixture.js'

describe('payments and balances', () => {
  let db: SqlDatabase
  let asOwner: InvoicesRepository
  let asManager: InvoicesRepository
  let asSales: InvoicesRepository

  beforeEach(async () => {
    db = await seededDatabase()
    asOwner = new InvoicesRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER }, TODAY)
    asManager = new InvoicesRepository(
      db,
      { role: 'manager', userId: MANAGER },
      { userId: MANAGER },
      TODAY,
    )
    asSales = new InvoicesRepository(db, { role: 'sales', userId: SALES }, { userId: SALES }, TODAY)
  })

  afterEach(async () => {
    await db.close()
  })

  const pay = (id: string, invoiceId: string, amount: number) => ({
    id,
    invoiceId,
    amountCents: amount,
    method: 'mpesa' as const,
    reference: 'SJ00TEST',
    paidAt: '2026-09-02T10:00:00.000Z',
    notes: null,
  })

  // ------------------------------------------------- FR-5.4 partial payments

  it('reduces the balance with each partial payment', async () => {
    const before = await asOwner.findSummary(INVOICE.unpaid)
    expect(before).toMatchObject({ paidCents: 0, balanceCents: 1000000, derivedStatus: 'unpaid' })

    await asOwner.recordPayment(pay('90000000-0000-4000-8000-000000000001', INVOICE.unpaid, 400000))
    const partly = await asOwner.findSummary(INVOICE.unpaid)
    expect(partly).toMatchObject({
      paidCents: 400000,
      balanceCents: 600000,
      derivedStatus: 'partially_paid',
    })

    await asOwner.recordPayment(pay('90000000-0000-4000-8000-000000000002', INVOICE.unpaid, 600000))
    const settled = await asOwner.findSummary(INVOICE.unpaid)
    expect(settled).toMatchObject({ paidCents: 1000000, balanceCents: 0, derivedStatus: 'paid' })
  })

  it('accepts an overpayment and shows a negative balance rather than silently capping it', async () => {
    await asOwner.recordPayment(
      pay('90000000-0000-4000-8000-000000000003', INVOICE.unpaid, 1200000),
    )
    const after = await asOwner.findSummary(INVOICE.unpaid)
    // Paid in full, with the excess visible so it can be investigated.
    expect(after?.balanceCents).toBe(-200000)
    expect(after?.derivedStatus).toBe('paid')
  })

  it('records method, reference, date and who received it (FR-5.3)', async () => {
    await asOwner.recordPayment({
      id: '90000000-0000-4000-8000-000000000004',
      invoiceId: INVOICE.unpaid,
      amountCents: 250000,
      method: 'bank_transfer',
      reference: 'FT26090412',
      paidAt: '2026-09-04T08:15:00.000Z',
      notes: 'Settled at the branch',
    })

    const detail = await asOwner.detail(INVOICE.unpaid)
    expect(detail?.payments[0]).toMatchObject({
      amount_cents: 250000,
      method: 'bank_transfer',
      reference: 'FT26090412',
      received_by: OWNER,
      notes: 'Settled at the branch',
    })
  })

  it('refuses a payment against a draft or a voided invoice', async () => {
    await expect(
      asOwner.recordPayment(pay('90000000-0000-4000-8000-000000000005', INVOICE.draft, 1000)),
    ).rejects.toThrow(/issue the invoice/i)

    await asOwner.voidInvoice(INVOICE.unpaid, 'Raised in error')
    await expect(
      asOwner.recordPayment(pay('90000000-0000-4000-8000-000000000006', INVOICE.unpaid, 1000)),
    ).rejects.toThrow(/voided invoice cannot take payments/i)
  })

  it('refuses a zero or negative payment', async () => {
    await expect(
      asOwner.recordPayment(pay('90000000-0000-4000-8000-000000000007', INVOICE.unpaid, 0)),
    ).rejects.toThrow(/more than zero/i)
  })

  // ------------------------------------------------- FR-5.5 append-only

  it('has no way to edit or delete a payment', () => {
    // The repository exposes recordPayment and reversePayment and nothing else.
    // Payments are append-only at every layer: no UPDATE or DELETE policy for
    // any role, no grant, and a trigger that raises on both.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(asOwner))
    expect(surface).toContain('recordPayment')
    expect(surface).toContain('reversePayment')
    expect(surface).not.toContain('updatePayment')
    expect(surface).not.toContain('deletePayment')
  })

  it('corrects a payment with a reversal, leaving both entries visible', async () => {
    const paymentId = '90000000-0000-4000-8000-000000000008'
    await asOwner.recordPayment(pay(paymentId, INVOICE.unpaid, 150000))
    expect((await asOwner.findSummary(INVOICE.unpaid))?.balanceCents).toBe(850000)

    await asManager.reversePayment({
      id: '91000000-0000-4000-8000-000000000001',
      paymentId,
      amountCents: 150000,
      reason: 'Duplicate entry of counter receipt 0142',
    })

    const after = await asOwner.detail(INVOICE.unpaid)
    expect(after?.invoice.balanceCents).toBe(1000000)
    expect(after?.invoice.reversedCents).toBe(150000)
    // The payment is still there — the record of what happened is not erased.
    expect(after?.payments).toHaveLength(1)
    expect(after?.payments[0]?.reversedCents).toBe(150000)
    expect(after?.reversals[0]?.reason).toContain('Duplicate entry')
  })

  it('lets only a manager or the owner reverse (FR-5.5)', async () => {
    const paymentId = '90000000-0000-4000-8000-000000000009'
    await asOwner.recordPayment(pay(paymentId, INVOICE.unpaid, 50000))

    await expect(
      asSales.reversePayment({
        id: '91000000-0000-4000-8000-000000000002',
        paymentId,
        amountCents: 50000,
        reason: 'mistake',
      }),
    ).rejects.toThrow(/only a manager or the owner can reverse/i)
  })

  it('refuses a reversal larger than what remains of the payment', async () => {
    const paymentId = '90000000-0000-4000-8000-00000000000a'
    await asOwner.recordPayment(pay(paymentId, INVOICE.unpaid, 100000))

    await asOwner.reversePayment({
      id: '91000000-0000-4000-8000-000000000003',
      paymentId,
      amountCents: 60000,
      reason: 'partial correction',
    })
    await expect(
      asOwner.reversePayment({
        id: '91000000-0000-4000-8000-000000000004',
        paymentId,
        amountCents: 60000,
        reason: 'too much',
      }),
    ).rejects.toThrow(/only 40000 cents .* remain/i)
  })

  it('requires a reason for every reversal', async () => {
    const paymentId = '90000000-0000-4000-8000-00000000000b'
    await asOwner.recordPayment(pay(paymentId, INVOICE.unpaid, 10000))
    await expect(
      asOwner.reversePayment({
        id: '91000000-0000-4000-8000-000000000005',
        paymentId,
        amountCents: 10000,
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(InvoiceRuleError)
  })

  it('scopes a sales user to invoices they raised (PRD 3.1)', async () => {
    // The owner raised every seeded invoice, so a sales user sees none of them —
    // and therefore cannot record a payment against one either.
    expect(await asSales.list({ view: 'all' })).toEqual([])
    expect(await asSales.findSummary(INVOICE.unpaid)).toBeNull()
    await expect(
      asSales.recordPayment(pay('90000000-0000-4000-8000-00000000000e', INVOICE.unpaid, 1000)),
    ).rejects.toThrow(/not found on this device/i)

    // The same invoice resolves for the owner, so the refusal is scope, not absence.
    expect(await asOwner.findSummary(INVOICE.unpaid)).not.toBeNull()
  })

  // ------------------------------------------------- FR-5.6 / FR-5.8

  it('computes overdue from the due date, not a stored flag', async () => {
    const overdue = await asOwner.findSummary(INVOICE.overdue)
    expect(overdue?.derivedStatus).toBe('overdue')
    // 08/08 to 04/09.
    expect(overdue?.daysOverdue).toBe(27)

    // Paying it settles it, and it stops being overdue with no job having run.
    await asOwner.recordPayment(
      pay('90000000-0000-4000-8000-00000000000c', INVOICE.overdue, 320000),
    )
    expect((await asOwner.findSummary(INVOICE.overdue))?.derivedStatus).toBe('paid')
  })

  it('lists overdue invoices with the contact details to chase them', async () => {
    const overdue = await asOwner.overdue()
    expect(overdue.map((i) => i.invoice_number)).toEqual(['INV-2026-0002'])

    const detail = await asOwner.detail(overdue[0]!.id)
    expect(detail?.clientPhone).toBe('+254712004518')
    expect(detail?.clientEmail).toBe('events@lanetgardens.example')
  })

  it('keeps a draft out of the outstanding and overdue views', async () => {
    const outstanding = await asOwner.list({ view: 'outstanding' })
    expect(outstanding.map((i) => i.id)).not.toContain(INVOICE.draft)
    expect((await asOwner.list({ view: 'draft' })).map((i) => i.id)).toEqual([INVOICE.draft])
  })

  // ------------------------------------------------- FR-5.1 / FR-5.6 voiding

  it('keeps the number when an invoice is voided, so nothing is reused', async () => {
    await asManager.voidInvoice(INVOICE.overdue, 'Issued to the wrong client')
    const voided = await asOwner.findSummary(INVOICE.overdue)
    expect(voided?.derivedStatus).toBe('voided')
    expect(voided?.invoice_number).toBe('INV-2026-0002')
  })

  it('refuses to void an invoice that has payments against it', async () => {
    await asOwner.recordPayment(pay('90000000-0000-4000-8000-00000000000d', INVOICE.unpaid, 5000))
    await expect(asOwner.voidInvoice(INVOICE.unpaid, 'changed mind')).rejects.toThrow(
      /reverse them before voiding/i,
    )
  })

  it('lets only a manager or the owner void', async () => {
    await expect(asSales.voidInvoice(INVOICE.unpaid, 'nope')).rejects.toThrow(
      /only a manager or the owner can void/i,
    )
  })
})
