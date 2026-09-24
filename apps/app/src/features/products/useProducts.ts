'use client'

import { useCallback, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { ProductsRepository } from './productsRepository.js'
import type { Category, ProductQuery, ProductStock } from './types.js'

export function useProductsRepository(): ProductsRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new ProductsRepository(
      db,
      { role: identity.role, userId: identity.userId },
      { userId: identity.userId, onLocalWrite: notifyLocalWrite },
    )
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

export function useProductList(query: ProductQuery) {
  const repo = useProductsRepository()
  const [products, setProducts] = useState<ProductStock[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { search, categoryId, stemForm, view } = query

  const load = useCallback(async () => {
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      setProducts(
        await repo.list({
          ...(search ? { search } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(stemForm ? { stemForm } : {}),
          ...(view ? { view } : {}),
        }),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read products.')
    } finally {
      setIsLoading(false)
    }
  }, [repo, search, categoryId, stemForm, view])

  useSyncedEffect(load)

  return { products, isLoading, error, reload: load }
}

export function useCategories(): { categories: Category[]; reload: () => Promise<void> } {
  const repo = useProductsRepository()
  const [categories, setCategories] = useState<Category[]>([])

  const load = useCallback(async () => {
    if (!repo) return
    setCategories(await repo.categories())
  }, [repo])

  // Re-read after a sync too: another device may have added one.
  useSyncedEffect(load)

  return { categories, reload: load }
}
