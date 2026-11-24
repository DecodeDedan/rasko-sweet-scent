import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@rasko/ui'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthProvider, useAuth } from '../../../auth/AuthProvider.js'
import { SyncProvider } from '../../../data/sync/SyncProvider.js'
import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { createFakeGateway, makeProfile } from '../../../test/fakeGateway.js'
import { LedgerScreen } from '../../ledger/LedgerScreen.js'
import { PackhouseScreen } from '../../packhouse/PackhouseScreen.js'
import { ReportsScreen } from '../ReportsScreen.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const TS = '2026-11-01T00:00:00.000Z'
const TODAY = new Date().toISOString().slice(0, 10)

async function seeded(): Promise<SqlDatabase> {
  const db = openNodeDatabase()
  await migrateLocalSchema(db)
  await db.execute(
    `INSERT INTO money_accounts (id, name, kind, currency, opening_balance_cents, opening_date,
                                 is_default, created_at, updated_at, sync_status)
     VALUES ('a1', 'M-Pesa', 'mpesa', 'KES', 250000, '2026-01-01', 1, ?, ?, 'synced')`,
    [TS, TS],
  )
  await db.execute(
    `INSERT INTO clients (id, name, client_type, created_at, updated_at, sync_status)
     VALUES (?, 'Kabuku Packhouse', 'corporate', ?, ?, 'synced')`,
    [CLIENT, TS, TS],
  )
  await db.execute(
    `INSERT INTO invoices (id, invoice_number, client_id, status, issue_date, due_date, total_cents,
                           currency, created_at, updated_at, sync_status)
     VALUES ('i1', 'INV-2026-0042', ?, 'issued', ?, ?, 1500000, 'KES', ?, ?, 'synced')`,
    [CLIENT, TODAY, TODAY, TS, TS],
  )
  await db.execute(
    `INSERT INTO packhouse_deliveries (id, client_id, delivery_date, delivery_note_number, status,
                                       created_at, updated_at, sync_status)
     VALUES ('d1', ?, ?, 'DN-290', 'dispatched', ?, ?, 'synced')`,
    [CLIENT, TODAY, TS, TS],
  )
  return db
}

function Signed({ db, children }: { db: SqlDatabase; children: ReactNode }) {
  const gateway = createFakeGateway({
    sessionUserId: OWNER,
    profiles: [makeProfile({ id: OWNER, role: 'owner', fullName: 'Test owner' })],
  })
  function WhenSignedIn() {
    const { status } = useAuth()
    return status === 'signed-in' ? <>{children}</> : <p>Loading identity</p>
  }
  return (
    <ToastProvider>
      <AuthProvider gateway={gateway}>
        <SyncProvider db={db} remote={null}>
          <WhenSignedIn />
        </SyncProvider>
      </AuthProvider>
    </ToastProvider>
  )
}

describe('the money and pack house screens', () => {
  let db: SqlDatabase

  beforeEach(async () => {
    db = await seeded()
  })

  afterEach(async () => {
    await db.close()
  })

  it('shows each account balance in the ledger', async () => {
    render(
      <Signed db={db}>
        <LedgerScreen role="owner" scope="Full" />
      </Signed>,
    )
    expect(await screen.findByRole('heading', { name: 'Ledger', level: 1 })).toBeInTheDocument()
    expect((await screen.findAllByText('KES 2,500.00')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Record money in or out' })).toBeEnabled()
  })

  it('lists a delivery awaiting intake', async () => {
    render(
      <Signed db={db}>
        <PackhouseScreen role="owner" scope="Full" />
      </Signed>,
    )
    const table = await screen.findByRole('table', { name: 'Pack house deliveries' })
    expect(await within(table).findByText('DN-290')).toBeInTheDocument()
    expect(within(table).getByText('Awaiting intake')).toBeInTheDocument()
  })

  it('builds a client statement on choosing the client', async () => {
    const user = userEvent.setup()
    render(
      <Signed db={db}>
        <ReportsScreen role="accountant" scope="Full" />
      </Signed>,
    )
    const picker = await screen.findByLabelText('Client')
    await screen.findByRole('option', { name: 'Kabuku Packhouse' })
    await user.selectOptions(picker, CLIENT)
    const table = await screen.findByRole('table', { name: 'KES account' })
    expect(within(table).getByText('INV-2026-0042')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeEnabled()
  })
})
