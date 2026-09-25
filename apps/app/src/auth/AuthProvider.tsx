'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { AuthGateway } from './gateway.js'
import { clearCachedIdentity, readCachedIdentity, writeCachedIdentity } from './sessionCache.js'
import { identityFromProfile } from './session.js'
import type { Identity, Role } from './session.js'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export interface AuthState {
  status: AuthStatus
  identity: Identity | null
  /** Signed in from the local cache because the server is unreachable (NFR-S6). */
  isOffline: boolean
  /** Why the last sign-in or restore failed, ready to display. */
  error: string | null
  /**
   * The server says this account no longer has access (offboarded or
   * deleted). The device should forget its copy of the business data.
   */
  accessRevoked?: boolean
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  /** FR-1.6: set a new password and clear the forced-change flag. */
  completePasswordChange: (newPassword: string) => Promise<{ error?: string }>
  requestPasswordReset: (email: string) => Promise<{ error?: string }>
  /** Re-reads the profile from the server. Used after a role change. */
  refresh: () => Promise<void>
  gateway: AuthGateway
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider.')
  return context
}

/** Convenience for components that only render when signed in. */
export function useIdentity(): Identity {
  const { identity } = useAuth()
  if (!identity) throw new Error('useIdentity used outside a signed-in tree.')
  return identity
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

const DEACTIVATED_MESSAGE =
  'This account has been deactivated. Contact the owner if you think that is a mistake.'

export interface AuthProviderProps {
  gateway: AuthGateway
  children: ReactNode
}

export function AuthProvider({ gateway, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    identity: null,
    isOffline: false,
    error: null,
  })

  // Guards against a slow boot resolving after the user has already signed out.
  const generation = useRef(0)

  /**
   * Establishes who is signed in.
   *
   * The important distinction is between "no session" and "cannot reach the
   * server". The first means sign out; the second means fall back to the cache,
   * because the user is still signed in — they just have no internet (T5).
   */
  const resolveIdentity = useCallback(
    async (options: { allowOfflineFallback: boolean }) => {
      const run = ++generation.current
      const cached = readCachedIdentity()

      // No network: there is nothing to verify against, so the cache is the
      // only answer available.
      if (!isOnline()) {
        if (run !== generation.current) return
        setState(
          cached
            ? { status: 'signed-in', identity: cached, isOffline: true, error: null }
            : {
                status: 'signed-out',
                identity: null,
                isOffline: true,
                error: 'You need to be online to sign in for the first time on this device.',
              },
        )
        return
      }

      try {
        const userId = await gateway.getSessionUserId()

        if (!userId) {
          clearCachedIdentity()
          if (run !== generation.current) return
          setState({ status: 'signed-out', identity: null, isOffline: false, error: null })
          return
        }

        const profile = await gateway.fetchProfile(userId)

        // No readable profile means either the row is missing or RLS refused
        // it — which is what a deactivated user sees, because every policy
        // tests is_active. Either way this device must stop.
        if (!profile || !profile.isActive) {
          await gateway.signOut()
          clearCachedIdentity()
          if (run !== generation.current) return
          setState({
            status: 'signed-out',
            identity: null,
            isOffline: false,
            error: DEACTIVATED_MESSAGE,
            accessRevoked: true,
          })
          return
        }

        const identity = identityFromProfile(profile)
        writeCachedIdentity(identity)
        if (run !== generation.current) return
        setState({ status: 'signed-in', identity, isOffline: false, error: null })
      } catch {
        // The request failed even though the browser believes it is online —
        // a captive portal, DNS failure, or the server being down. Same
        // treatment as offline: trust the cache if we have one.
        if (run !== generation.current) return
        if (options.allowOfflineFallback && cached) {
          setState({ status: 'signed-in', identity: cached, isOffline: true, error: null })
        } else {
          setState({
            status: 'signed-out',
            identity: null,
            isOffline: false,
            error: 'Cannot reach the server. Check your connection and try again.',
          })
        }
      }
    },
    [gateway],
  )

  // Boot.
  useEffect(() => {
    void resolveIdentity({ allowOfflineFallback: true })
  }, [resolveIdentity])

  // Supabase refreshing, restoring or dropping a session.
  useEffect(() => {
    return gateway.onAuthChange((userId) => {
      if (userId === null) {
        clearCachedIdentity()
        setState({ status: 'signed-out', identity: null, isOffline: false, error: null })
      }
    })
  }, [gateway])

  /**
   * Reconnecting is the moment a deactivation takes effect on this device (T4).
   * Until then the cached identity is still on screen; the server has been
   * refusing every request the whole time.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return

    function handleOnline() {
      void resolveIdentity({ allowOfflineFallback: false })
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [resolveIdentity])

  const signIn = useCallback(
    async (email: string, password: string) => {
      setState((current) => ({ ...current, error: null }))
      const result = await gateway.signIn(email, password)
      if (result.error) return { error: result.error }

      await resolveIdentity({ allowOfflineFallback: false })
      return {}
    },
    [gateway, resolveIdentity],
  )

  const signOut = useCallback(async () => {
    generation.current += 1
    await gateway.signOut()
    clearCachedIdentity()
    setState({ status: 'signed-out', identity: null, isOffline: false, error: null })
  }, [gateway])

  const completePasswordChange = useCallback(
    async (newPassword: string) => {
      const updated = await gateway.updatePassword(newPassword)
      if (updated.error) return { error: updated.error }

      const identity = state.identity
      if (identity) {
        const cleared = await gateway.clearMustChangePassword(identity.userId)
        if (cleared.error) return { error: cleared.error }
      }

      await resolveIdentity({ allowOfflineFallback: false })
      return {}
    },
    [gateway, resolveIdentity, state.identity],
  )

  const requestPasswordReset = useCallback(
    (email: string) => gateway.requestPasswordReset(email),
    [gateway],
  )

  const refresh = useCallback(
    () => resolveIdentity({ allowOfflineFallback: true }),
    [resolveIdentity],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signOut,
      completePasswordChange,
      requestPasswordReset,
      refresh,
      gateway,
    }),
    [state, signIn, signOut, completePasswordChange, requestPasswordReset, refresh, gateway],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Roles that may reach owner-only surfaces. Kept next to the provider so the
 *  check is one import, not a scattered string comparison. */
export function isOwner(role: Role | undefined): boolean {
  return role === 'owner'
}
