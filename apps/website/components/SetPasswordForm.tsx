'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Field, Input } from '@rasko/ui'

/** Same rule the app states (ForcePasswordChangeScreen) and the server
 *  enforces (supabase/config.toml minimum_password_length). */
const MIN_PASSWORD_LENGTH = 8

type LinkType = 'invite' | 'recovery'

type State =
  | { step: 'verifying' }
  | { step: 'invalid'; message: string }
  | { step: 'ready' }
  | { step: 'done'; mustChangeAgain: boolean }

const EXPIRED_LINK =
  'This link has expired or has already been used. In the app, choose Forgot your password to get a new one, or ask the owner to send the invitation again.'
const OFFLINE = 'The password could not be saved. Check your connection and try again.'

// The session lives in memory only. This page exists to set one password; a
// session left in this browser's storage would outlive that purpose.
function browserClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function parseLinkType(value: string | null): LinkType | null {
  return value === 'invite' || value === 'recovery' ? value : null
}

function friendlyUpdateError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('different from the old'))
    return 'Choose a password you have not used here before.'
  if (lower.includes('weak') || lower.includes('at least'))
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (lower.includes('session') || lower.includes('jwt')) return EXPIRED_LINK
  return OFFLINE
}

export function SetPasswordForm() {
  const params = useSearchParams()
  const tokenHash = params.get('token_hash')
  const linkType = parseLinkType(params.get('type'))

  const clientRef = useRef<SupabaseClient | null>(null)
  const [state, setState] = useState<State>({ step: 'verifying' })
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    // A token is single-use. React's development double-invoke would spend it
    // on the first call and report the link as expired on the second, so the
    // verification runs once per page load and its result is never discarded.
    if (clientRef.current) return
    const client = browserClient()
    clientRef.current = client

    if (!tokenHash || !linkType) {
      setState({
        step: 'invalid',
        message: 'This page opens from the link in an invitation or password-reset email.',
      })
      return
    }

    client.auth
      .verifyOtp({ token_hash: tokenHash, type: linkType })
      .then(({ error: verifyError }) =>
        setState(verifyError ? { step: 'invalid', message: EXPIRED_LINK } : { step: 'ready' }),
      )
      .catch(() =>
        setState({
          step: 'invalid',
          message: 'The link could not be checked. Check your connection and reload this page.',
        }),
      )
  }, [tokenHash, linkType])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const client = clientRef.current
    if (!client) return

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }

    setIsSaving(true)
    try {
      const { data, error: updateError } = await client.auth.updateUser({ password })
      if (updateError || !data.user) {
        setError(friendlyUpdateError(updateError?.message ?? ''))
        return
      }

      // FR-1.6 asks that an invited user choose their own password, which they
      // just did. Clearing the flag spares them a second forced change in the
      // app. profiles_update_self permits it; profiles_guard_privileges still
      // blocks role and is_active. If it fails the password is still set and
      // the app simply asks once more, so the page says so rather than failing.
      let mustChangeAgain = false
      if (linkType === 'invite') {
        const { error: profileError } = await client
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', data.user.id)
        mustChangeAgain = profileError !== null
      }

      await client.auth.signOut({ scope: 'local' })
      setState({ step: 'done', mustChangeAgain })
    } catch {
      setError(OFFLINE)
    } finally {
      setIsSaving(false)
    }
  }

  const title = linkType === 'invite' ? 'Choose your password' : 'Set a new password'

  return (
    <div className="rw-card rw-auth">
      <div className="rw-card__body rw-auth__body">
        <h1 className="rw-card__title rw-auth__title">{title}</h1>

        {state.step === 'verifying' ? (
          <p className="rw-auth__text" role="status">
            Checking your link.
          </p>
        ) : null}

        {state.step === 'invalid' ? (
          <p className="rw-auth__text" role="alert">
            {state.message}
          </p>
        ) : null}

        {state.step === 'done' ? (
          <p className="rw-auth__text" role="status">
            Your password is saved. Return to the Rasko Sweet Scent app and sign in with it.
            {state.mustChangeAgain ? ' The app will ask you to confirm a password once more.' : ''}
          </p>
        ) : null}

        {state.step === 'ready' ? (
          <form className="rw-auth__form" onSubmit={handleSubmit} noValidate>
            <p className="rw-auth__text">
              Set a password only you know. You will use it to sign in to the app.
            </p>

            {error ? (
              <p className="rw-auth__error" role="alert">
                {error}
              </p>
            ) : null}

            <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSaving}
              />
            </Field>

            <Field label="Confirm new password">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={isSaving}
              />
            </Field>

            <Button type="submit" variant="primary" isFullWidth isLoading={isSaving}>
              Save password
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  )
}
