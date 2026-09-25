import { useEffect } from 'react'
import { useToast } from '@rasko/ui'
import type { Update } from '@tauri-apps/plugin-updater'

import { isTauriRuntime } from '../data/bootstrap.js'

/**
 * Desktop auto-update (PRD §7). The Tauri updater only acts when asked, and
 * GitHub cannot tell an installed copy that a release exists, so this asks
 * often: just after launch, every 15 minutes, whenever the window comes back
 * into focus or the connection returns, and on demand from Settings.
 *
 * A newer signed release (tauri.conf.json pubkey) is offered in a toast that
 * stays until it is installed: installing restarts the app, so the person at
 * the device chooses the moment, but cannot lose the offer. Unsent changes are
 * safe across that restart: the outbox is SQLite on disk, not memory.
 *
 * After a restart onto a new version, a toast says so once.
 */

const FIRST_CHECK_DELAY_MS = 3_000
const CHECK_EVERY_MS = 15 * 60 * 1000
/** Focus and reconnect can fire in bursts; one check a minute is plenty. */
const MIN_GAP_MS = 60 * 1000
const SEEN_VERSION_KEY = 'rasko.version.seen'
const CHECK_NOW_EVENT = 'rasko:check-for-updates'

/** Asks for an update check now, reporting the outcome (Settings → System). */
export function requestUpdateCheck(): void {
  window.dispatchEvent(new Event(CHECK_NOW_EVENT))
}

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
    // Development builds run from Vite, not an installed copy: nothing to
    // replace, so only an explicit request gets an answer.
    const canUpdate = isTauriRuntime() && !import.meta.env.DEV

    let cancelled = false
    // One offer per version, however many checks find it.
    let offered: string | null = null
    let lastCheck = 0
    let inFlight = false

    async function install(update: Update) {
      const progressId = showToast({
        title: `Installing version ${update.version}`,
        description: 'Downloading. The app restarts by itself when it is done.',
        duration: null,
        isDismissible: false,
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
          description: `${reason(cause)} It will be offered again at the next check.`,
        })
      }
    }

    async function checkForUpdate(isManual: boolean) {
      if (!canUpdate) {
        if (isManual) {
          showToast({ title: 'Updates are checked by the installed app, not this preview.' })
        }
        return
      }
      if (inFlight || (!isManual && Date.now() - lastCheck < MIN_GAP_MS)) return
      inFlight = true
      lastCheck = Date.now()
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (cancelled) return
        if (!update) {
          if (isManual) {
            showToast({
              tone: 'success',
              title: 'You are on the latest version',
              description: `Version ${__APP_VERSION__}.`,
            })
          }
          return
        }
        if (offered === update.version) return
        offered = update.version
        showToast({
          title: `Version ${update.version} is available`,
          description: `You are on ${__APP_VERSION__}. Installing restarts the app; unsent changes are kept.`,
          duration: null,
          isDismissible: false,
          action: { label: 'Install update', onClick: () => void install(update) },
        })
      } catch (cause) {
        // Offline or GitHub unreachable: the app works without it and the next
        // check tries again, so only a check someone asked for says so.
        if (isManual && !cancelled) {
          showToast({
            tone: 'danger',
            title: 'Could not check for updates',
            description: reason(cause),
          })
        }
      } finally {
        inFlight = false
      }
    }

    const automatic = () => void checkForUpdate(false)
    const manual = () => void checkForUpdate(true)
    const first = setTimeout(automatic, FIRST_CHECK_DELAY_MS)
    const repeat = setInterval(automatic, CHECK_EVERY_MS)
    window.addEventListener('focus', automatic)
    window.addEventListener('online', automatic)
    window.addEventListener(CHECK_NOW_EVENT, manual)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(repeat)
      window.removeEventListener('focus', automatic)
      window.removeEventListener('online', automatic)
      window.removeEventListener(CHECK_NOW_EVENT, manual)
    }
  }, [showToast, dismissToast])
}
