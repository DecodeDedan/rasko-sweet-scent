'use client'

import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '@rasko/ui'

import { useSync } from '../data/sync/SyncProvider.js'

/**
 * FR-9.4: a sync indicator on every screen — synced / N pending / offline —
 * plus a manual "Sync now".
 *
 * Reads the real queue depth from the sync provider. When no device database is
 * present (a browser preview), the provider reports `unavailable` and this falls
 * back to reporting connectivity alone, with the action disabled — it does not
 * claim a sync state it cannot know.
 */
export function SyncStatus() {
  const { phase, pending, syncNow } = useSync()
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const isUnavailable = phase === 'unavailable'
  const offline = !isOnline || phase === 'offline'

  let label: string
  let tone: 'synced' | 'pending' | 'offline' = 'synced'

  if (isUnavailable) {
    label = isOnline ? 'Connected' : 'Offline'
    tone = isOnline ? 'synced' : 'offline'
  } else if (phase === 'syncing') {
    label = 'Syncing'
    tone = 'pending'
  } else if (offline) {
    label = pending > 0 ? `Offline, ${pending} pending` : 'Offline'
    tone = 'offline'
  } else if (phase === 'error') {
    label = 'Sync blocked'
    tone = 'offline'
  } else if (pending > 0) {
    label = `${pending} pending`
    tone = 'pending'
  } else {
    label = 'Synced'
  }

  return (
    <div className="shell__sync">
      <span
        className={cx('shell__sync-dot', tone !== 'synced' && `shell__sync-dot--${tone}`)}
        aria-hidden="true"
      />
      <span>{label}</span>
      <button
        type="button"
        className="rsk-icon-btn rsk-icon-btn--sm"
        onClick={() => void syncNow()}
        disabled={isUnavailable || !isOnline || phase === 'syncing'}
        aria-label="Sync now"
        title={isUnavailable ? 'Sync runs on the installed app' : 'Sync now'}
      >
        <RefreshCw size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
