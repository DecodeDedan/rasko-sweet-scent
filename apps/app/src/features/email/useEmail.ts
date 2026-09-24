'use client'

import { useCallback, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { EmailRepository } from './emailRepository.js'
import type { OutboundEmail, RelatedTable } from './emailRepository.js'

export function useEmailRepository(): EmailRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new EmailRepository(db, identity.role, {
      userId: identity.userId,
      onLocalWrite: notifyLocalWrite,
    })
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

/**
 * Which emails to list: `all`, `client:<id>`, or `<table>:<id>` for one record.
 * A string, so it is a stable hook dependency.
 */
export type EmailScope = 'all' | `client:${string}` | `${RelatedTable}:${string}`

/**
 * Re-read after every sync, which is when a queued email's status comes back
 * from the server.
 */
export function useEmailHistory(scope: EmailScope | null) {
  const repo = useEmailRepository()
  const [emails, setEmails] = useState<OutboundEmail[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!repo || !scope) return
    try {
      setError(null)
      if (scope === 'all') {
        setEmails(await repo.recent())
        return
      }
      const [kind, id] = scope.split(':') as [string, string]
      setEmails(
        kind === 'client'
          ? await repo.historyForClient(id)
          : await repo.historyFor(kind as RelatedTable, id),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read sent emails.')
    }
  }, [repo, scope])

  useSyncedEffect(load)

  return { emails, error, reload: load }
}
