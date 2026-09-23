'use client'

import { useEffect } from 'react'

import { useSync } from './SyncProvider.js'

/**
 * Runs `load` on mount, and again every time a sync lands.
 *
 * Every screen reads the local SQLite mirror, and the sync engine fills that
 * mirror on its own schedule (NFR-S3: launch, after each write, every five
 * minutes, on reconnect). A screen that only loads on mount therefore shows
 * whatever happened to be in the database at the moment it rendered.
 *
 * On a cold start that is nothing. The first pull of the day finishes a second
 * or two after the dashboard has already drawn itself, so the owner opens the
 * app and reads KES 0.00 across every tile while the real figures sit in the
 * database underneath. Navigating away and back "fixes" it, which is how this
 * kind of bug survives: it looks like the data is missing, not like the screen
 * is stale.
 *
 * `lastSyncedAt` changes on every successful sync, so depending on it is what
 * turns a pull into a redraw.
 */
export function useSyncedEffect(load: () => void | Promise<void>): void {
  const { lastSyncedAt } = useSync()

  useEffect(() => {
    void load()
  }, [load, lastSyncedAt])
}
