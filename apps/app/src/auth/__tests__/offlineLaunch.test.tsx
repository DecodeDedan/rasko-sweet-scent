import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../../App.js'
import { createFakeGateway, makeProfile } from '../../test/fakeGateway.js'
import { setOnline } from '../../test/setup.js'
import { readCachedIdentity } from '../sessionCache.js'

/**
 * FR-1.2 / NFR-S6 / T5 — "Fresh install → login once → kill network → full
 * restart → app fully usable with cached data."
 *
 * A restart is modelled by unmounting and rendering App again with the same
 * localStorage, which is exactly what persists across a real relaunch.
 */
describe('offline launch after restart', () => {
  it('caches the identity on a successful online sign-in', async () => {
    const user = userEvent.setup()
    render(<App gateway={createFakeGateway({ sessionUserId: null })} />)

    await user.type(await screen.findByLabelText('Email'), 'owner@raskosweetscent.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    const cached = readCachedIdentity()
    expect(cached).toMatchObject({
      email: 'owner@raskosweetscent.example',
      role: 'owner',
    })
  })

  it('opens straight into the app after a restart with no network', async () => {
    const user = userEvent.setup()

    // --- first launch, online: sign in ---
    const first = render(<App gateway={createFakeGateway({ sessionUserId: null })} />)
    await user.type(await screen.findByLabelText('Email'), 'owner@raskosweetscent.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    first.unmount()

    // --- network dies, app restarts ---
    setOnline(false)
    const offlineGateway = createFakeGateway({ sessionUserId: 'user-owner', offline: true })
    render(<App gateway={offlineGateway} />)

    // Signed in, from cache. No login screen.
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()

    // And the user is told why the data may be stale. Matched on the banner's
    // own wording: "offline" alone also appears in the account menu.
    expect(screen.getByText(/showing the last data this device synced/i)).toBeInTheDocument()
  })

  it('keeps the cached role, so navigation is correct offline', async () => {
    const user = userEvent.setup()
    const profiles = [
      makeProfile({
        id: 'user-sales',
        email: 'sales@raskosweetscent.example',
        fullName: 'Daniel Kiplagat',
        role: 'sales',
      }),
    ]

    const first = render(<App gateway={createFakeGateway({ sessionUserId: null, profiles })} />)
    await user.type(await screen.findByLabelText('Email'), 'sales@raskosweetscent.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    first.unmount()

    setOnline(false)
    render(<App gateway={createFakeGateway({ sessionUserId: 'user-sales', offline: true })} />)
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    const sidebar = document.querySelector('.shell__sidebar') as HTMLElement
    const labels = [...sidebar.querySelectorAll('.shell__nav-item')].map((n) => n.textContent)

    // Still scoped to sales offline: no suppliers, payroll, settings, users or audit.
    expect(labels).toEqual(['Dashboard', 'Clients', 'Orders', 'Invoices', 'Products'])
  })

  it('asks the user to go online when there is no cache to fall back on', async () => {
    setOnline(false)
    render(<App gateway={createFakeGateway({ sessionUserId: null, offline: true })} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/need to be online/i)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  /**
   * T4 — deactivated while the device was offline. The cached identity keeps
   * the app usable until the device reconnects; at that point the server
   * refuses it and this device signs out.
   */
  it('signs the user out on reconnect if they were deactivated meanwhile', async () => {
    const user = userEvent.setup()
    const profiles = [makeProfile({ id: 'user-owner' })]
    const gateway = createFakeGateway({ sessionUserId: null, profiles })

    render(<App gateway={gateway} />)
    await user.type(await screen.findByLabelText('Email'), 'owner@raskosweetscent.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    // The owner is deactivated elsewhere while this device is offline.
    setOnline(false)
    gateway.setOffline(true)
    gateway.getProfiles()[0]!.isActive = false

    // Reconnect.
    setOnline(true)
    gateway.setOffline(false)
    window.dispatchEvent(new Event('online'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/deactivated/i)
    })
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    // The cache is discarded, so a further restart cannot resurrect the session.
    expect(readCachedIdentity()).toBeNull()
  })

  it('clears the cache on an explicit sign out', async () => {
    const user = userEvent.setup()
    render(<App gateway={createFakeGateway({ sessionUserId: 'user-owner' })} />)
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(await screen.findByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(readCachedIdentity()).toBeNull())
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
