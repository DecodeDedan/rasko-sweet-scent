'use client'

import { useCallback, useMemo, useState } from 'react'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSync } from '../../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
import { SettingsRepository } from './settingsRepository.js'
import type { CompanyProfile, StatutoryRate, TaxConfig } from './settingsRepository.js'

export function useSettingsRepository(): SettingsRepository | null {
  const { db, notifyLocalWrite } = useSync()
  const identity = useIdentity()

  return useMemo(() => {
    if (!db) return null
    return new SettingsRepository(db, identity.role, {
      userId: identity.userId,
      onLocalWrite: notifyLocalWrite,
    })
  }, [db, identity.role, identity.userId, notifyLocalWrite])
}

export interface SystemStatus {
  lastSyncedAt: string | null
  pendingWrites: number
  failedWrites: number
  deviceRows: number
}

export function useSettingsData() {
  const repo = useSettingsRepository()
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [tax, setTax] = useState<TaxConfig | null>(null)
  const [rates, setRates] = useState<StatutoryRate[]>([])
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!repo) return
    try {
      setError(null)
      const [profileRow, taxRow, rateRows, statusRow] = await Promise.all([
        repo.companyProfile(),
        repo.taxConfig(),
        repo.statutoryRates(),
        repo.systemStatus(),
      ])
      setProfile(profileRow)
      setTax(taxRow)
      setRates(rateRows)
      setStatus(statusRow)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read settings.')
    }
  }, [repo])

  useSyncedEffect(load)

  return { repo, profile, tax, rates, status, error, reload: load }
}
