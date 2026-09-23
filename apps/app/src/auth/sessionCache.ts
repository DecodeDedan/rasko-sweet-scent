/**
 * Offline identity cache (FR-1.2, NFR-S6, T5).
 *
 * Supabase persists its own tokens, but that is not enough to open offline: the
 * client tries to refresh an expired token on startup, and with no network that
 * fails and yields no session. The app would then show a login screen to a user
 * who is already signed in — precisely the failure T5 exists to catch.
 *
 * So the app keeps its own small record of who is signed in and what role they
 * hold, written on every successful online boot and read when the network is
 * unavailable.
 *
 * THIS IS NOT AN AUTHORISATION. It decides what this device draws while offline
 * and nothing else. Every read and write still goes to the server with a real
 * JWT, and RLS decides what is permitted (PRD §3.1). A user deactivated while
 * their device was offline keeps drawing their old screens until they reconnect,
 * at which point the server refuses them and this cache is discarded — which is
 * exactly the behaviour T4 specifies.
 */

import { isRole } from './session.js'
import type { Identity } from './session.js'

const STORAGE_KEY = 'rasko.identity.v1'

/**
 * A cached identity older than this is not trusted for an offline launch. It
 * bounds how long a device that never reconnects keeps working, which bounds
 * how stale a revoked role can be on screen.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface CachedIdentity extends Identity {
  cachedAt: number
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Private mode, or a WebView with site data disabled. Not fatal: the app
    // simply cannot open offline.
    return null
  }
}

export function readCachedIdentity(now: number = Date.now()): Identity | null {
  const store = storage()
  if (!store) return null

  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<CachedIdentity>
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.fullName !== 'string' ||
      typeof parsed.cachedAt !== 'number' ||
      !isRole(parsed.role)
    ) {
      return null
    }

    if (now - parsed.cachedAt > MAX_AGE_MS) {
      store.removeItem(STORAGE_KEY)
      return null
    }

    return {
      userId: parsed.userId,
      fullName: parsed.fullName,
      email: parsed.email,
      role: parsed.role,
      mustChangePassword: parsed.mustChangePassword === true,
    }
  } catch {
    // Corrupt payload. Treat as absent rather than crashing the boot.
    return null
  }
}

export function writeCachedIdentity(identity: Identity, now: number = Date.now()): void {
  const store = storage()
  if (!store) return
  try {
    const payload: CachedIdentity = { ...identity, cachedAt: now }
    store.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota or disabled storage; offline launch is lost but the app still runs.
  }
}

export function clearCachedIdentity(): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do.
  }
}
