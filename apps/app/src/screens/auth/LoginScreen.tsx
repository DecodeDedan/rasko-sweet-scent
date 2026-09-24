'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal, PasswordInput } from '@rasko/ui'

import { BrandMark } from '../../shell/BrandMark.js'
import { AuthLayout } from './AuthLayout.js'

import { useAuth } from '../../auth/AuthProvider.js'

/**
 * FR-1.1: email and password against Supabase Auth, PKCE flow.
 *
 * Brand rules apply here as much as anywhere: no emoji, no exclamation marks,
 * Lora for the title, Rasko Green for the only primary action.
 */
export function LoginScreen() {
  const { signIn, requestPasswordReset, error: bootError } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [isResetOpen, setIsResetOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [resetError, setResetError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)

    if (!email.trim() || !password) {
      setFormError('Enter your email and password.')
      return
    }

    setIsSubmitting(true)
    const result = await signIn(email, password)
    setIsSubmitting(false)
    if (result.error) setFormError(result.error)
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault()
    setResetError(null)
    setResetState('sending')

    const result = await requestPasswordReset(resetEmail || email)
    if (result.error) {
      setResetError(result.error)
      setResetState('idle')
      return
    }
    setResetState('sent')
  }

  // A boot failure (deactivated account, server unreachable) is shown until the
  // user types, at which point their own attempt takes over the message slot.
  const message = formError ?? bootError

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div className="auth-brand">
          {/* The panel carries the brand on desktop; on a phone it is hidden, so the form does. */}
          <BrandMark height={44} className="auth-brand__mark" />
          <div>
            <h1 className="auth-title">Sign in</h1>
            <p className="auth-subtitle">RSS Management System</p>
          </div>
        </div>

        {message ? (
          <p className="auth-error" role="alert">
            {message}
          </p>
        ) : null}

        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <Field label="Password">
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <Button type="submit" variant="primary" isFullWidth isLoading={isSubmitting}>
          Sign in
        </Button>

        <button
          type="button"
          className="auth-link"
          onClick={() => {
            setResetEmail(email)
            setResetState('idle')
            setResetError(null)
            setIsResetOpen(true)
          }}
        >
          Forgot your password
        </button>
      </form>

      {/*
        FR-1.5. Mounted only while open: a closed <dialog> keeps its contents in
        the DOM and the accessibility tree, which would put a second field
        labelled "Email" behind the sign-in form.
      */}
      {isResetOpen ? (
        <Modal
          isOpen={isResetOpen}
          onClose={() => setIsResetOpen(false)}
          title="Reset your password"
          description="We will email you a link to set a new password."
          size="sm"
          footer={
            resetState === 'sent' ? (
              <Button variant="primary" onClick={() => setIsResetOpen(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button onClick={() => setIsResetOpen(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={handleReset}
                  isLoading={resetState === 'sending'}
                >
                  Send link
                </Button>
              </>
            )
          }
        >
          {resetState === 'sent' ? (
            <p>
              If an account exists for that email, a reset link is on its way. The link opens a page
              where you set a new password, then sign in here with it.
            </p>
          ) : (
            <>
              {resetError ? (
                <p className="auth-error" role="alert">
                  {resetError}
                </p>
              ) : null}
              <Field label="Email">
                <Input
                  type="email"
                  autoComplete="username"
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                />
              </Field>
            </>
          )}
        </Modal>
      ) : null}
    </AuthLayout>
  )
}
