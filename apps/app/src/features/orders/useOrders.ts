'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { OrdersRepository } from './ordersRepository.js'
import type { OrderQuery, OrderSummary, ProductOption } from './types.js'

export function useOrdersRepository(): OrdersRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new OrdersRepository(
      db,
      { role: identity.role, userId: identity.userId },
      { userId: identity.userId, onLocalWrite: notifyLocalWrite },
    )
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

export function useOrderList(query: OrderQuery) {
  const repo = useOrdersRepository()
  const [orders, setOrders] = useState<OrderSummary[]>([])
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
      setOrders(await repo.list({ ...(search ? { search } : {}), ...(status ? { status } : {}) }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read orders.')
    } finally {
      setIsLoading(false)
    }
  }, [repo, search, status])

  useSyncedEffect(load)

  return { orders, isLoading, error, reload: load }
}

/** The catalogue for the line picker, loaded once per screen. */
export function useProducts(): ProductOption[] {
  const repo = useOrdersRepository()
  const [products, setProducts] = useState<ProductOption[]>([])

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    void repo.products().then((rows) => {
      if (!cancelled) setProducts(rows)
    })
    return () => {
      cancelled = true
    }
  }, [repo])

  return products
}

export function useClientOptions(): Array<{ id: string; name: string }> {
  const repo = useOrdersRepository()
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    void repo.clients().then((rows) => {
      if (!cancelled) setClients(rows)
    })
    return () => {
      cancelled = true
    }
  }, [repo])

  return clients
}
