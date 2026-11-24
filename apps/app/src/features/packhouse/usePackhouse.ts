'use client'

import { useMemo } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { PackhouseRepository } from './packhouseRepository.js'

export function usePackhouseRepository(): PackhouseRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new PackhouseRepository(db, identity.role, {
      userId: identity.userId,
      onLocalWrite: notifyLocalWrite,
    })
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}
