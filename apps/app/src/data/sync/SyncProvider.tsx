'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { SqlDatabase } from '../sqlite/types.js'
import { pendingCount } from './outbox.js'
import type { SyncRemote } from './remote.js'
import { SyncScheduler } from './scheduler.js'
import type { SchedulerEvent } from './scheduler.js'

/**
 * Feeds the FR-9.4 indicator: synced / N pending / offline, plus "Sync now".
 */

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'unavailable'

export interface SyncState {
  phase: SyncPhase
  pending: number
  lastSyncedAt: string | null
  lastError: string | null
}

export interface SyncContextValue extends SyncState {
  syncNow: () => Promise<void>
  /** Repositories call this after a write so the scheduler can debounce. */
  notifyLocalWrite: () => void
  /**
   * The device database. Null outside Tauri, where there is none — feature
   * screens must render a clear state rather than assuming it exists.
   */
  db: SqlDatabase | null
}

const SyncContext = createContext<SyncContextValue | null>(null)

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext)
  if (!context) throw new Error('useSync must be used within a SyncProvider.')
  return context
}

export interface SyncProviderProps {
  /**
   * Null when there is no device database — a browser preview, or any build
   * running outside Tauri. The indicator then reports `unavailable` rather than
   * claiming a sync state it cannot know.
   */
  db: SqlDatabase | null
  remote: SyncRemote | null
  onAuthFailure?: () => void
  children: ReactNode
}

export function SyncProvider({ db, remote, onAuthFailure, children }: SyncProviderProps) {
  const [state, setState] = useState<SyncState>({
    phase: db && remote ? 'idle' : 'unavailable',
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
  })

  const scheduler = useMemo(() => {
    if (!db || !remote) return null
    return new SyncScheduler(db, remote, {
      onEvent: (event: SchedulerEvent) => {
        setState({
          phase: event.outcome.error ? (event.outcome.authFailed ? 'error' : 'offline') : 'idle',
          pending: event.pending,
          lastSyncedAt: event.outcome.error ? null : new Date().toISOString(),
          lastError: event.outcome.error,
        })
      },
      ...(onAuthFailure ? { onAuthFailure } : {}),
    })
  }, [db, remote, onAuthFailure])

  useEffect(() => {
    if (!scheduler) return
    scheduler.start()
    return () => scheduler.stop()
  }, [scheduler])

  const syncNow = useCallback(async () => {
    if (!scheduler || !db) return
    setState((current) => ({ ...current, phase: 'syncing' }))
    await scheduler.syncNow()
    setState((current) => ({ ...current, pending: current.pending }))
  }, [scheduler, db])

  const notifyLocalWrite = useCallback(() => {
    scheduler?.notifyLocalWrite()
    if (db) void pendingCount(db).then((pending) => setState((c) => ({ ...c, pending })))
  }, [scheduler, db])

  const value = useMemo<SyncContextValue>(
    () => ({ ...state, syncNow, notifyLocalWrite, db }),
    [state, syncNow, notifyLocalWrite, db],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
