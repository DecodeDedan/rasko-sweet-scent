import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SqlDatabase } from '../../../data/sqlite/types.js'
import {
  InvoiceDocument,
  localPhone,
  splitAmount,
  stampDate,
  writtenRate,
} from '../InvoiceDocument.js'
import { InvoicesRepository } from '../invoicesRepository.js'
import { INVOICE, OWNER, TODAY, seededDatabase } from './fixture.js'

const ORDER = '90000000-0000-4000-8000-000000000001'
const TS = '2026-09-01T00:00:00.000Z'

describe('printed invoice', () => {
  let db: SqlDatabase
  let repo: InvoicesRepository

  beforeEach(async () => {
    db = await seededDatabase()
    repo = new InvoicesRepository(db, { role: 'owner', userId: OWNER }, { userId: OWNER }, TODAY)

    await db.execute(
      `INSERT INTO orders (id, order_number, delivery_number, status, created_at, updated_at,
                           sync_status)
       VALUES (?, 'ORD-2026-0217', '217', 'delivered', ?, ?, 'synced')`,
      [ORDER, TS, TS],
    )
    const line = (id: string, position: number, text: string, qty: number, price: number) =>
      db.execute(
        `INSERT INTO order_items (id, order_id, description, quantity, unit_price_cents,
                                  discount_cents, line_total_cents, position,
                                  created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'synced')`,
        // quantity is stored in thousandths
        [id, ORDER, text, qty * 1000, price, qty * price, position, TS, TS],
      )
    await line('91000000-0000-4000-8000-000000000002', 2, 'Baby Blue spray', 400, 1500)
    await line('91000000-0000-4000-8000-000000000001', 1, 'Baby Blue standard', 600, 1000)
    await db.execute('UPDATE invoices SET order_id = ? WHERE id = ?', [ORDER, INVOICE.unpaid])
  })

  afterEach(async () => {
    await db.close()
  })

  it('prints the order lines in position order with the order number', async () => {
    const detail = await repo.detail(INVOICE.unpaid)
    const company = await repo.companySettings()
    render(<InvoiceDocument detail={detail!} company={company} onClose={() => {}} />)

    const rows = screen.getAllByRole('row')
    const first = rows.findIndex((row) => within(row).queryByText('Baby Blue standard'))
    const second = rows.findIndex((row) => within(row).queryByText('Baby Blue spray'))
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(first + 1)

    const standard = within(rows[first]!)
    expect(standard.getByText('600')).toBeInTheDocument()
    expect(standard.getByText('10')).toBeInTheDocument()
    expect(standard.getByText('6,000')).toBeInTheDocument()

    expect(screen.getByText('ORD-2026-0217')).toBeInTheDocument()
    expect(screen.getByText('217')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Ksh' })).toBeInTheDocument()
    expect(screen.getByText('INV-2026-0001')).toBeInTheDocument()
    expect(screen.getByText('KRA PIN', { exact: false })).toBeInTheDocument()
  })

  it('heads the money column and writes the total in the invoice currency', async () => {
    await db.execute("UPDATE invoices SET currency = 'USD', total_cents = 10800 WHERE id = ?", [
      INVOICE.unpaid,
    ])
    const detail = await repo.detail(INVOICE.unpaid)
    render(<InvoiceDocument detail={detail!} company={null} onClose={() => {}} />)

    expect(screen.getByRole('columnheader', { name: 'USD' })).toBeInTheDocument()
    expect(screen.getByText('$ 108')).toBeInTheDocument()
  })

  it('prints both letterhead numbers and puts the new email in the stamp', async () => {
    await db.execute(
      "UPDATE company_settings SET phone = '+254700339635', whatsapp = '+254101339635', email = 'info@raskosweetscent.com'",
    )
    const detail = await repo.detail(INVOICE.unpaid)
    const company = await repo.companySettings()
    const { container } = render(
      <InvoiceDocument detail={detail!} company={company} onClose={() => {}} />,
    )

    expect(screen.getByText('0700 339 635')).toBeInTheDocument()
    expect(screen.getByText('0101 339 635')).toBeInTheDocument()
    expect(container.textContent).toContain('email:info@raskosweetscent.com')
    expect(screen.queryByText(/^Due$/)).not.toBeInTheDocument()
  })

  it('stamps an issued invoice with its own issue date', async () => {
    const detail = await repo.detail(INVOICE.unpaid)
    render(<InvoiceDocument detail={detail!} company={null} onClose={() => {}} />)

    expect(
      screen.getByLabelText('Rasko Sweet Scent Ltd stamp, signed and dated 01 SEP 2026'),
    ).toBeInTheDocument()
  })

  it('leaves a draft unstamped and prints one line when there is no order', async () => {
    const detail = await repo.detail(INVOICE.draft)
    render(<InvoiceDocument detail={detail!} company={null} onClose={() => {}} />)

    expect(screen.queryByLabelText(/stamp, signed/)).not.toBeInTheDocument()
    expect(screen.getByText('Goods and services')).toBeInTheDocument()
    expect(screen.getByText('Assigned on sync')).toBeInTheDocument()
  })
})

describe('splitAmount', () => {
  it('splits minor units into the two money columns', () => {
    expect(splitAmount(1234505)).toEqual({ units: '12,345', cents: '05' })
    expect(splitAmount(0)).toEqual({ units: '0', cents: '00' })
    expect(splitAmount(-2550)).toEqual({ units: '-25', cents: '50' })
    expect(splitAmount(Number.NaN)).toEqual({ units: '0', cents: '00' })
  })
})

describe('writtenRate', () => {
  it('drops the cents only when there are none', () => {
    expect(writtenRate(1800)).toBe('18')
    expect(writtenRate(18)).toBe('0.18')
    expect(writtenRate(1850)).toBe('18.50')
  })
})

describe('localPhone', () => {
  it('prints numbers the way the letterhead does', () => {
    expect(localPhone('+254700339635')).toBe('0700 339 635')
    expect(localPhone('+254101339635')).toBe('0101 339 635')
    expect(localPhone('not a number')).toBe('not a number')
  })
})

describe('stampDate', () => {
  it('reads the calendar date without a timezone shift', () => {
    expect(stampDate('2026-08-23')).toBe('23 AUG 2026')
    expect(stampDate('2026-12-31T23:30:00.000Z')).toBe('31 DEC 2026')
    expect(stampDate('not a date')).toBe('')
  })
})
