'use client'

import { useCallback, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { ClientsRepository } from './clientsRepository.js'
import type { ClientQuery, ClientSummary } from './types.js'

/**
 * The clients repository, scoped to the signed-in user.
 *
 * Null when there is no device database — a browser preview. Screens must
 * render that state rather than assuming storage exists.
 */
export function useClientsRepository(): ClientsRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new ClientsRepository(
      db,
      { role: identity.role, userId: identity.userId },
      { userId: identity.userId, onLocalWrite: notifyLocalWrite },
    )
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

export interface ClientListState {
  clients: ClientSummary[]
  isLoading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useClientList(query: ClientQuery): ClientListState {
  const repo = useClientsRepository()
  const [clients, setClients] = useState<ClientSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { search, type, sort } = query

  const load = useCallback(async () => {
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      const rows = await repo.list({
        ...(search ? { search } : {}),
        ...(type ? { type } : {}),
        ...(sort ? { sort } : {}),
      })
      setClients(rows)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read clients.')
    } finally {
      setIsLoading(false)
    }
  }, [repo, search, type, sort])

  useSyncedEffect(load)

  return { clients, isLoading, error, reload: load }
}
