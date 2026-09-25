import { act, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider, useToast } from '@rasko/ui'
import { beforeEach, describe, expect, it } from 'vitest'

import { AuthProvider, useAuth } from '../../auth/AuthProvider.js'
import { createFakeGateway, makeProfile } from '../../test/fakeGateway.js'
import { requestUpdateCheck, useAppUpdate } from '../useAppUpdate.js'

function UpdateProbe() {
  useAppUpdate()
  return null
}

describe('after an update', () => {
  beforeEach(() => localStorage.clear())

  it('says once which version is now running', async () => {
    localStorage.setItem('rasko.version.seen', '0.0.9')
    const { unmount } = render(
      <ToastProvider>
        <UpdateProbe />
      </ToastProvider>,
    )
    expect(await screen.findByText(`Updated to version ${__APP_VERSION__}`)).toBeTruthy()
    expect(localStorage.getItem('rasko.version.seen')).toBe(__APP_VERSION__)
    unmount()

    render(
      <ToastProvider>
        <UpdateProbe />
      </ToastProvider>,
    )
    expect(screen.queryByText(/Updated to version/)).toBeNull()
  })

  it('says nothing on the very first launch', () => {
    render(
      <ToastProvider>
        <UpdateProbe />
      </ToastProvider>,
    )
    expect(screen.queryByText(/Updated to version/)).toBeNull()
    expect(localStorage.getItem('rasko.version.seen')).toBe(__APP_VERSION__)
  })
})

describe('checking for updates on request', () => {
  it('answers even outside the installed app, instead of doing nothing', async () => {
    render(
      <ToastProvider>
        <UpdateProbe />
      </ToastProvider>,
    )
    act(() => requestUpdateCheck())
    expect(await screen.findByText(/checked by the installed app/)).toBeTruthy()
  })
})

function PinnedToast() {
  const { showToast } = useToast()
  return (
    <button
      onClick={() =>
        showToast({
          title: 'Version 9.9.9 is available',
          duration: null,
          isDismissible: false,
          action: { label: 'Install update', onClick: () => {} },
        })
      }
    >
      Offer
    </button>
  )
}

describe('the update offer', () => {
  it('cannot be closed, only acted on', async () => {
    render(
      <ToastProvider>
        <PinnedToast />
      </ToastProvider>,
    )
    act(() => screen.getByRole('button', { name: 'Offer' }).click())
    expect(await screen.findByRole('button', { name: 'Install update' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})

function RevokedProbe() {
  const { status, accessRevoked } = useAuth()
  return <p>{`${status}:${accessRevoked === true}`}</p>
}

describe('an account that has lost access', () => {
  it('is flagged so the device forgets its copy', async () => {
    const gateway = createFakeGateway({
      sessionUserId: 'user-owner',
      profiles: [makeProfile({ id: 'user-owner', isActive: false })],
    })
    render(
      <AuthProvider gateway={gateway}>
        <RevokedProbe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('signed-out:true')).toBeTruthy())
  })

  it('is not flagged for an ordinary signed-out launch', async () => {
    render(
      <AuthProvider gateway={createFakeGateway({ sessionUserId: null })}>
        <RevokedProbe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('signed-out:false')).toBeTruthy())
  })
})
