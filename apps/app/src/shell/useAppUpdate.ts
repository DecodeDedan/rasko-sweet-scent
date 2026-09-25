import { useEffect } from 'react'
import { useToast } from '@rasko/ui'
import type { Update } from '@tauri-apps/plugin-updater'

import { isTauriRuntime } from '../data/bootstrap.js'

/**
 * Desktop auto-update (PRD §7). The Tauri updater only acts when asked, so
 * this asks: shortly after launch and every few hours while the app is open.
 * A newer signed release (tauri.conf.json pubkey) is offered in a toast; the
 * person at the device decides when to install, because installing restarts
 * the app. Unsent changes are safe across that restart: the outbox is SQLite
 * on disk, not memory.
 *
 * After a restart onto a new version, a toast says so once.
 */

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const SEEN_VERSION_KEY = 'rasko.version.seen'

/** The version the app last ran as, or null on first run or unreadable storage. */
function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_VERSION_KEY)
  } catch {
    return null
  }
}

function writeSeenVersion(version: string): void {
  try {
    localStorage.setItem(SEEN_VERSION_KEY, version)
  } catch {
    // Storage refused (private mode, quota): the "updated" toast is a
    // courtesy, and missing it costs nothing.
  }
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function useAppUpdate(): void {
  const { showToast, dismissToast } = useToast()

  // Announce a completed update once, on the first launch of the new version.
  useEffect(() => {
    const seen = readSeenVersion()
    if (seen !== null && seen !== __APP_VERSION__) {
      showToast({
        tone: 'success',
        title: `Updated to version ${__APP_VERSION__}`,
        description: 'The RSS Management System is up to date.',
      })
    }
    writeSeenVersion(__APP_VERSION__)
  }, [showToast])

  useEffect(() => {
    // Development builds run from Vite, not an installed copy; there is
    // nothing to replace.
    if (!isTauriRuntime() || import.meta.env.DEV) return

    let cancelled = false
    // One offer per version, however many checks find it.
    let offered: string | null = null

    async function install(update: Update) {
      const progressId = showToast({
        title: `Installing version ${update.version}`,
        description: 'Downloading. The app restarts by itself when it is done.',
        duration: null,
      })
      try {
        await update.downloadAndInstall()
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      } catch (cause) {
        dismissToast(progressId)
        offered = null
        showToast({
          tone: 'danger',
          title: 'The update did not install',
          description: `${reason(cause)} It will be offered again later.`,
        })
      }
    }

    async function checkForUpdate() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (cancelled || !update || offered === update.version) return
        offered = update.version
        showToast({
          title: `Version ${update.version} is available`,
          description: `You are on ${__APP_VERSION__}. Installing restarts the app; unsent changes are kept.`,
          duration: null,
          action: { label: 'Install update', onClick: () => void install(update) },
        })
      } catch {
        // Offline, or GitHub unreachable: the app works without it, and the
        // next check tries again. Not worth interrupting anyone for.
      }
    }

    const first = setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS)
    const repeat = setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(repeat)
    }
  }, [showToast, dismissToast])
}
