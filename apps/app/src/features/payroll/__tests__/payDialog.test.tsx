import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@rasko/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider, useAuth } from '../../../auth/AuthProvider.js'
import type { PayoutWallet } from '../../../auth/gateway.js'
import { openNodeDatabase } from '../../../data/sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../../../data/sqlite/schema.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { SyncProvider } from '../../../data/sync/SyncProvider.js'
import { createFakeGateway, makeProfile } from '../../../test/fakeGateway.js'
import { PayMpesaDialog } from '../PayMpesaDialog.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const RUN = 'f0000000-0000-4000-8000-000000000001'
const TS = '2026-09-27T08:00:00.000Z'
const JOHN = 'e0000002-0000-4000-8000-000000000000'

/** Jane is payable (KES 23,456); John has no M-Pesa number. */
async function seed(db: SqlDatabase) {
  await db.execute(
    `INSERT INTO payroll_runs (id, period_year, period_month, status, created_at, updated_at, sync_status)
     VALUES (?, 2026, 9, 'approved', ?, ?, 'synced')`,
    [RUN, TS, TS],
  )
  const people: Array<[string, string, string | null, number]> = [
    ['e0000001-0000-4000-8000-000000000000', 'Jane Wanjiku', '+254712345678', 2345600],
    [JOHN, 'John Kamau', null, 1500000],
  ]
  for (const [id, name, phone, net] of people) {
    await db.execute(
      `INSERT INTO employees (id, full_name, national_id, phone, salary_type, payment_method,
                              is_active, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, 'monthly', 'mpesa', 1, ?, ?, 'synced')`,
      [id, name, `ID-${name}`, phone, TS, TS],
    )
    await db.execute(
      `INSERT INTO payroll_items (id, payroll_run_id, employee_id, net_pay_cents,
                                  created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, 'synced')`,
      [`i-${id}`, RUN, id, net, TS, TS],
    )
  }
}

function Harness({
  db,
  wallet,
  offline = false,
  onFixEmployee,
}: {
  db: SqlDatabase
  wallet?: PayoutWallet | { error: string }
  offline?: boolean
  onFixEmployee: (id: string) => void
}) {
  const gateway = createFakeGateway({
    sessionUserId: OWNER,
    profiles: [makeProfile({ id: OWNER, role: 'owner' })],
    ...(wallet ? { wallet } : {}),
  })
  function WhenSignedIn() {
    const { status } = useAuth()
    if (status !== 'signed-in') return <p>Loading identity</p>
    // Offline is switched on after sign-in, so identity still resolves.
    gateway.setOffline(offline)
    return (
      <PayMpesaDialog
        runId={RUN}
        periodLabel="Payroll for September 2026"
        refreshKey={0}
        onClose={() => {}}
        onRequested={() => {}}
        onFixEmployee={onFixEmployee}
      />
    )
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

describe('Pay salaries dialog', () => {
  let db: SqlDatabase

  beforeEach(async () => {
    db = openNodeDatabase()
    await migrateLocalSchema(db)
    await seed(db)
  })

  afterEach(async () => {
    await db.close()
  })

  const sendButton = () => screen.getByRole('button', { name: /Send KES/ })

  it('refuses to send a run the IntaSend wallet cannot cover, and says by how much', async () => {
    render(
      <Harness
        db={db}
        wallet={{ provider: 'intasend', availableCents: 2000000, updatedAt: null }}
        onFixEmployee={() => {}}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/short by KES 3,456/)
    expect(sendButton()).toBeDisabled()
  })

  it('sends when the wallet covers the run, then stays open and follows the payments', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        db={db}
        wallet={{ provider: 'intasend', availableCents: 5000000, updatedAt: null }}
        onFixEmployee={() => {}}
      />,
    )
    expect(await screen.findByText(/IntaSend wallet: KES 50,000\.00/)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Type the total to confirm/), '23456')
    await user.click(sendButton())

    expect(await screen.findByText(/0 of 1 paid · 1 on the way/)).toBeInTheDocument()
    expect(screen.getByText('Waiting to send')).toBeInTheDocument()
    // Nothing is left to pay, so the only way on is to close.
    expect(screen.queryByRole('button', { name: /Send KES/ })).toBeNull()
  })

  it('offers to fix an employee whose details block the payment', async () => {
    const user = userEvent.setup()
    const onFixEmployee = vi.fn()
    render(<Harness db={db} onFixEmployee={onFixEmployee} />)

    await user.click(
      await screen.findByRole('button', { name: 'Fix payment details for John Kamau' }),
    )
    expect(onFixEmployee).toHaveBeenCalledWith(JOHN)
    expect(screen.queryByRole('button', { name: /Fix payment details for Jane/ })).toBeNull()
  })

  it('shows no wallet under Daraja, and still lets the owner send when the balance is unreachable', async () => {
    const { unmount } = render(<Harness db={db} onFixEmployee={() => {}} />)
    await waitFor(() => expect(sendButton()).toBeEnabled())
    expect(screen.queryByText(/IntaSend wallet/)).toBeNull()
    unmount()

    render(
      <Harness
        db={db}
        offline
        wallet={{ provider: 'intasend', availableCents: 0, updatedAt: null }}
        onFixEmployee={() => {}}
      />,
    )
    expect(await screen.findByText(/Wallet balance not available/)).toBeInTheDocument()
    expect(sendButton()).toBeEnabled()
  })
})
