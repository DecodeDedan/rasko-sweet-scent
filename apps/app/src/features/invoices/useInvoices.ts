'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { InvoicesRepository } from './invoicesRepository.js'
import type { CompanySettings, InvoiceQuery, InvoiceSummary } from './types.js'

export function useInvoicesRepository(): InvoicesRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new InvoicesRepository(
      db,
      { role: identity.role, userId: identity.userId },
      { userId: identity.userId, onLocalWrite: notifyLocalWrite },
    )
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

export function useInvoiceList(query: InvoiceQuery) {
  const repo = useInvoicesRepository()
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { search, view } = query

  const load = useCallback(async () => {
    if (!repo) {
      setIsLoading(false)
      return
    }
    try {
      setError(null)
      setInvoices(await repo.list({ ...(search ? { search } : {}), ...(view ? { view } : {}) }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read invoices.')
    } finally {
      setIsLoading(false)
    }
  }, [repo, search, view])

  useSyncedEffect(load)

  return { invoices, isLoading, error, reload: load }
}

export function useCompanySettings(): CompanySettings | null {
  const repo = useInvoicesRepository()
  const [company, setCompany] = useState<CompanySettings | null>(null)

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    void repo.companySettings().then((row) => {
      if (!cancelled) setCompany(row)
    })
    return () => {
      cancelled = true
    }
  }, [repo])

  return company
}
