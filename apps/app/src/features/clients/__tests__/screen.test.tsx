import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@rasko/ui'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthProvider, useAuth } from '../../../auth/AuthProvider.js'
import { SyncProvider } from '../../../data/sync/SyncProvider.js'
import type { SqlDatabase } from '../../../data/sqlite/types.js'
import { createFakeGateway, makeProfile } from '../../../test/fakeGateway.js'
import type { Role } from '../../../auth/session.js'
import { ClientsScreen } from '../ClientsScreen.js'
import { OWNER, SALES, seededDatabase } from './fixture.js'

/**
 * The screen wired to a real local database, so what is asserted is the whole
 * path: query -> repository -> SQLite -> render.
 */
function Harness({ db, role, userId }: { db: SqlDatabase; role: Role; userId: string }) {
  const gateway = createFakeGateway({
    sessionUserId: userId,
    profiles: [makeProfile({ id: userId, role, fullName: `Test ${role}` })],
  })

  const scope = role === 'sales' ? 'Own clients only' : 'All'

  /**
   * Identity resolves asynchronously, exactly as it does in the real app, so the
   * screen must not mount before it is available — useIdentity throws otherwise.
   * App.tsx gates on the same condition.
   */
  function WhenSignedIn() {
    const { status } = useAuth()
    if (status !== 'signed-in') return <p>Loading identity</p>
    return <ClientsScreen role={role} scope={scope} />
  }

  return (
    <ToastProvider>
      <AuthProvider gateway={gateway}>
        {/* No remote: this test is about the screen, not the sync engine. */}
        <SyncProvider db={db} remote={null}>
          <WhenSignedIn />
        </SyncProvider>
      </AuthProvider>
    </ToastProvider>
  )
}

describe('ClientsScreen', () => {
  let db: SqlDatabase

  beforeEach(async () => {
    db = await seededDatabase()
  })

  afterEach(async () => {
    await db.close()
  })

  /*
   * jsdom applies no stylesheet, so rsk-desktop-only and rsk-mobile-only do not
   * hide anything and BOTH the table and the mobile cards are in the document.
   * Every query below is scoped to one of them; a document-wide getByText would
   * match twice and fail for the wrong reason.
   */
  function table() {
    return document.querySelector('.rsk-desktop-only .rsk-table') as HTMLElement
  }
  function desktop() {
    return document.querySelector('.rsk-desktop-only') as HTMLElement
  }

  it('lists every client for the owner with their balances', async () => {
    render(<Harness db={db} role="owner" userId={OWNER} />)

    await waitFor(() => expect(table()).toBeTruthy())
    const rows = within(table()).getAllByRole('row')
    // Six clients plus the header row.
    expect(rows).toHaveLength(7)

    expect(within(table()).getByText('Menengai Events & Planning')).toBeInTheDocument()
    // Formatted per PRD §7. Menengai's lifetime and outstanding are the same
    // figure — nothing has been paid — so this legitimately appears twice.
    expect(within(table()).getAllByText('KES 127,500.00')).toHaveLength(2)
  })

  // ------------------------------------------------------------- search

  it('filters the list by name as the user types', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="owner" userId={OWNER} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.type(screen.getByLabelText('Search clients'), 'menengai')

    await waitFor(() => {
      expect(within(table()).getAllByRole('row')).toHaveLength(2) // header + 1
    })
    expect(within(table()).getByText('Menengai Events & Planning')).toBeInTheDocument()
  })

  it('finds a client by a phone number typed the local way', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="owner" userId={OWNER} />)
    await waitFor(() => expect(table()).toBeTruthy())

    // Stored as +254712004518; a Kenyan user types the trunk-prefixed form.
    await user.type(screen.getByLabelText('Search clients'), '0712004518')

    await waitFor(() => {
      expect(within(table()).getByText('Lanet Gardens Hotel')).toBeInTheDocument()
    })
    expect(within(table()).getAllByRole('row')).toHaveLength(2)
  })

  it('explains an empty result and offers a way back', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="owner" userId={OWNER} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.type(screen.getByLabelText('Search clients'), 'zzzz')

    await waitFor(() => {
      expect(within(desktop()).getByText('No clients match')).toBeInTheDocument()
    })
    expect(within(desktop()).getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('filters by client type', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="owner" userId={OWNER} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.selectOptions(screen.getByLabelText('Filter by type'), 'corporate')

    await waitFor(() => {
      expect(within(table()).getAllByRole('row')).toHaveLength(3) // header + 2
    })
    expect(within(table()).getByText('Lanet Gardens Hotel')).toBeInTheDocument()
    expect(within(table()).queryByText('Grace Wanjiru Kamau')).not.toBeInTheDocument()
  })

  // -------------------------------------------------- FR-3.4 permission

  it('shows a sales user only the clients they created', async () => {
    render(<Harness db={db} role="sales" userId={SALES} />)

    await waitFor(() => expect(table()).toBeTruthy())
    const rows = within(table()).getAllByRole('row')
    expect(rows).toHaveLength(3) // header + 2

    expect(within(table()).getByText('Peter Otieno Ochieng')).toBeInTheDocument()
    expect(within(table()).getByText('Mercy Chebet Kiplagat')).toBeInTheDocument()
    // Belongs to the manager.
    expect(within(table()).queryByText('Lanet Gardens Hotel')).not.toBeInTheDocument()
  })

  it('keeps the sales scope when searching', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="sales" userId={SALES} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.type(screen.getByLabelText('Search clients'), 'Lanet')

    // Exists in the database, but not for this user.
    await waitFor(() => {
      expect(within(desktop()).getByText('No clients match')).toBeInTheDocument()
    })
  })

  it('shows the role scope on the page header', async () => {
    render(<Harness db={db} role="sales" userId={SALES} />)
    expect(await screen.findByText('Own clients only')).toBeInTheDocument()
  })

  // -------------------------------------------------- FR-3.5 delete guard

  it('replaces delete with the reason when the client still owes money', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="owner" userId={OWNER} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.click(within(table()).getByText('Menengai Events & Planning'))

    const dialog = await screen.findByRole('dialog')
    // No disabled button to puzzle over — the footer says why.
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(
      within(dialog).getByText(/Cannot delete: KES 127,500\.00 is still outstanding/),
    ).toBeInTheDocument()
  })

  it('allows delete for a client who owes nothing', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="owner" userId={OWNER} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.click(within(table()).getByText('Grace Wanjiru Kamau'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(dialog).queryByText(/Cannot delete/)).not.toBeInTheDocument()
  })

  it('tells a sales user why they cannot delete', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="sales" userId={SALES} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.click(within(table()).getByText('Mercy Chebet Kiplagat'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(
      within(dialog).getByText('Only a manager or the owner can delete a client.'),
    ).toBeInTheDocument()
  })

  // ------------------------------------------------------ FR-3.3 detail

  it('shows lifetime value, outstanding balance and history', async () => {
    const user = userEvent.setup()
    render(<Harness db={db} role="owner" userId={OWNER} />)
    await waitFor(() => expect(table()).toBeTruthy())

    await user.click(within(table()).getByText('Lanet Gardens Hotel'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Lifetime value')).toBeInTheDocument()
    expect(within(dialog).getByText('Outstanding')).toBeInTheDocument()
    // 68,500 is both the lifetime figure and the single invoice's total.
    expect(within(dialog).getAllByText('KES 68,500.00').length).toBeGreaterThanOrEqual(1)
    // 48,500 is the outstanding figure and that invoice's balance.
    expect(within(dialog).getAllByText('KES 48,500.00').length).toBeGreaterThanOrEqual(1)
    expect(within(dialog).getByText('INV-2026-0002')).toBeInTheDocument()
    expect(within(dialog).getByText('30 days')).toBeInTheDocument()
  })
})
