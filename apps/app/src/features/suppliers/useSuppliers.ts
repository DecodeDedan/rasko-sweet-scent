'use client'

import { useCallback, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { SuppliersRepository } from './suppliersRepository.js'
import type { PurchaseSummary, SupplierQuery, SupplierSummary } from './types.js'

export function useSuppliersRepository(): SuppliersRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new SuppliersRepository(db, identity.role, {
      userId: identity.userId,
      onLocalWrite: notifyLocalWrite,
    })
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

export function useSupplierList(query: SupplierQuery) {
  const repo = useSuppliersRepository()
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { search } = query

  const load = useCallback(async () => {
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      setSuppliers(await repo.listSuppliers({ ...(search ? { search } : {}) }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read suppliers.')
    } finally {
      setIsLoading(false)
    }
  }, [repo, search])

  useSyncedEffect(load)

  return { suppliers, isLoading, error, reload: load }
}

export function usePurchaseList(query: SupplierQuery) {
  const repo = useSuppliersRepository()
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { search, status } = query

  const load = useCallback(async () => {
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      setPurchases(
        await repo.listPurchases({
          ...(search ? { search } : {}),
          ...(status ? { status } : {}),
        }),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read purchases.')
    } finally {
      setIsLoading(false)
    }
  }, [repo, search, status])

  useSyncedEffect(load)

  return { purchases, isLoading, error, reload: load }
}
