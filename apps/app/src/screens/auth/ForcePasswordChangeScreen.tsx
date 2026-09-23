'use client'

import { useState } from 'react'
import { Button, Field, Input } from '@rasko/ui'

import { useAuth } from '../../auth/AuthProvider.js'

/** Matches the Supabase project default. Kept in one place so the rule stated
 *  to the user and the rule enforced are the same value. */
const MIN_PASSWORD_LENGTH = 8

/**
 * FR-1.6: an invited user must choose their own password before reaching the
 * app. This is a full-screen gate rather than a dismissible prompt — an invited
 * account is still holding the password whoever invited them typed.
 */
export function ForcePasswordChangeScreen() {
  const { completePasswordChange, signOut, identity } = useAuth()

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }

    setIsSubmitting(true)
    const result = await completePasswordChange(password)
    setIsSubmitting(false)
    if (result.error) setError(result.error)
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div>
          <h1 className="auth-title">Choose your password</h1>
          <p className="auth-subtitle">
            {identity ? `Signed in as ${identity.email}. ` : ''}
            Set a password only you know before you continue.
          </p>
        </div>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <Button type="submit" variant="primary" isFullWidth isLoading={isSubmitting}>
          Save and continue
        </Button>

        <button type="button" className="auth-link" onClick={() => void signOut()}>
          Sign out instead
        </button>
      </form>
    </div>
  )
}
