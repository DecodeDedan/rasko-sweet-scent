'use client'

import { useMemo } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { LedgerRepository } from './ledgerRepository.js'

export function useLedgerRepository(): LedgerRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new LedgerRepository(db, identity.role, {
      userId: identity.userId,
      onLocalWrite: notifyLocalWrite,
    })
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

/** Today and the first of this month in Africa/Nairobi (UTC+3 all year). */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return { from: `${today.slice(0, 8)}01`, to: today }
}
