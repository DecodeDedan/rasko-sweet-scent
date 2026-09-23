import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../../App.js'
import { createFakeGateway, makeProfile } from '../../test/fakeGateway.js'

/** FR-1.1 — email and password sign-in. */
describe('sign in', () => {
  it('shows the login screen when there is no session', async () => {
    render(<App gateway={createFakeGateway({ sessionUserId: null })} />)

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('rejects a wrong password without entering the app', async () => {
    const user = userEvent.setup()
    render(<App gateway={createFakeGateway({ sessionUserId: null })} />)

    await user.type(await screen.findByLabelText('Email'), 'owner@raskosweetscent.example')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
    // Still on the login screen — no shell behind the error.
    expect(screen.queryByRole('navigation', { name: 'Modules' })).not.toBeInTheDocument()
  })

  it('does not reveal whether the email exists', async () => {
    const user = userEvent.setup()
    render(<App gateway={createFakeGateway({ sessionUserId: null })} />)

    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com')
    await user.type(screen.getByLabelText('Password'), 'anything')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    // Identical wording to the wrong-password case, so the form cannot be used
    // to enumerate accounts.
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
  })

  it('signs in with the correct password and opens the shell', async () => {
    const user = userEvent.setup()
    const gateway = createFakeGateway({ sessionUserId: null, password: 'correct-horse' })
    render(<App gateway={gateway} />)

    await user.type(await screen.findByLabelText('Email'), 'owner@raskosweetscent.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    expect(gateway.calls.signIn).toHaveLength(1)
  })

  it('reports a refused sign-in when the server is unreachable', async () => {
    const user = userEvent.setup()
    const gateway = createFakeGateway({ sessionUserId: null })
    gateway.setOffline(true)
    render(<App gateway={gateway} />)

    await user.type(await screen.findByLabelText('Email'), 'owner@raskosweetscent.example')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i)
  })

  /** FR-1.6 — an invited user must choose their own password first. */
  it('forces a password change before the app is reachable', async () => {
    const gateway = createFakeGateway({
      sessionUserId: 'user-invited',
      profiles: [
        makeProfile({
          id: 'user-invited',
          email: 'newstaff@raskosweetscent.example',
          fullName: 'New Staff',
          role: 'sales',
          mustChangePassword: true,
        }),
      ],
    })
    render(<App gateway={gateway} />)

    expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeInTheDocument()
    // The shell is not behind it.
    expect(screen.queryByRole('navigation', { name: 'Modules' })).not.toBeInTheDocument()
  })

  it('enters the app once the new password is saved', async () => {
    const user = userEvent.setup()
    const gateway = createFakeGateway({
      sessionUserId: 'user-invited',
      profiles: [
        makeProfile({
          id: 'user-invited',
          email: 'newstaff@raskosweetscent.example',
          fullName: 'New Staff',
          role: 'sales',
          mustChangePassword: true,
        }),
      ],
    })
    render(<App gateway={gateway} />)

    await user.type(await screen.findByLabelText('New password'), 'a-longer-passphrase')
    await user.type(screen.getByLabelText('Confirm new password'), 'a-longer-passphrase')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument()
    })
  })

  it('refuses a password change when the two entries differ', async () => {
    const user = userEvent.setup()
    render(
      <App
        gateway={createFakeGateway({
          sessionUserId: 'user-invited',
          profiles: [makeProfile({ id: 'user-invited', mustChangePassword: true })],
        })}
      />,
    )

    await user.type(await screen.findByLabelText('New password'), 'a-longer-passphrase')
    await user.type(screen.getByLabelText('Confirm new password'), 'something-else')
    await user.click(screen.getByRole('button', { name: 'Save and continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
  })

  /** FR-1.5 — password reset request. */
  it('requests a password reset without confirming the email exists', async () => {
    const user = userEvent.setup()
    const gateway = createFakeGateway({ sessionUserId: null })
    render(<App gateway={gateway} />)

    await user.click(await screen.findByRole('button', { name: /forgot your password/i }))

    // The sign-in form is still mounted behind the dialog, so it also has a
    // field labelled Email. Scope to the dialog rather than the whole document.
    const dialog = within(await screen.findByRole('dialog'))
    await user.clear(dialog.getByLabelText('Email'))
    await user.type(dialog.getByLabelText('Email'), 'someone@example.com')
    await user.click(dialog.getByRole('button', { name: 'Send link' }))

    expect(await screen.findByText(/if an account exists for that email/i)).toBeInTheDocument()
    expect(gateway.calls.resetRequests).toContain('someone@example.com')
  })
})
