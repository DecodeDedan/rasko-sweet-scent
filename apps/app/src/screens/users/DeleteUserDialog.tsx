'use client'

import { useState } from 'react'
import { Button, Field, Input, Modal } from '@rasko/ui'

import type { AuthGateway } from '../../auth/gateway.js'
import type { ProfileRecord } from '../../auth/session.js'

/**
 * Deleting an offboarded account (delete-user). It cannot be undone, so the
 * super admin types the person's name: the dialog then deletes exactly the
 * account they read, not the row next to it.
 */
export function DeleteUserDialog({
  gateway,
  target,
  onClose,
  onDeleted,
}: {
  gateway: AuthGateway
  target: ProfileRecord
  onClose: () => void
  onDeleted: () => void
}) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const matches = typed.trim().toLowerCase() === target.fullName.trim().toLowerCase()

  async function remove() {
    setError(null)
    setIsDeleting(true)
    try {
      const result = await gateway.deleteUser(target.id)
      if (result.error) return setError(result.error)
      onDeleted()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title="Delete this account"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!matches}
            isLoading={isDeleting}
            onClick={() => void remove()}
          >
            Delete account
          </Button>
        </>
      }
    >
      <div className="rsk-stack">
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <p>
          {target.fullName} will not be able to sign in again, their email and phone number are
          removed, and their company address stops receiving mail. This cannot be undone.
        </p>
        <p>
          Their name stays on the invoices, payments and other records they made, because those are
          the business&apos;s records.
        </p>
        <Field label={`Type ${target.fullName} to confirm`}>
          <Input autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
