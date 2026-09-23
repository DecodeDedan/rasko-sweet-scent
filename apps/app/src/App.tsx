import { ToastProvider } from '@rasko/ui'
import { useEffect, useMemo, useState } from 'react'

import { AuthProvider, useAuth } from './auth/AuthProvider.js'
import { openDeviceSync } from './data/bootstrap.js'
import type { DeviceSync } from './data/bootstrap.js'
import { SyncProvider } from './data/sync/SyncProvider.js'
import { AuthLoading } from './auth/guards.js'
import type { AuthGateway } from './auth/gateway.js'
import { createSupabaseGateway } from './auth/supabaseGateway.js'
import { ForcePasswordChangeScreen, LoginScreen } from './screens/index.js'
import { AppShell } from './shell/AppShell.js'

/**
 * The single decision about what the whole application is showing.
 *
 * Ordering matters: `loading` must come first so no frame ever flashes a login
 * form at a user who is already signed in, and the forced password change must
 * come before the shell so an invited account cannot reach the app while still
 * holding the password someone else typed (FR-1.6).
 */
function AuthGate() {
  const { status, identity, refresh } = useAuth()
  const [device, setDevice] = useState<DeviceSync | null>(null)

  // The device database is opened once the user is through the gate: there is
  // nothing to sync before that, and opening it earlier would put a SQLite file
  // on disk for someone who never signs in.
  useEffect(() => {
    if (status !== 'signed-in') return
    let cancelled = false
    void openDeviceSync().then((opened) => {
      if (!cancelled) setDevice(opened)
    })
    return () => {
      cancelled = true
    }
  }, [status])

  if (status === 'loading') return <AuthLoading />
  if (status === 'signed-out' || !identity) return <LoginScreen />
  if (identity.mustChangePassword) return <ForcePasswordChangeScreen />

  return (
    <SyncProvider
      db={device?.db ?? null}
      remote={device?.remote ?? null}
      // T4: the server refusing this device is how a deactivation arrives.
      // Re-checking the identity signs the user out.
      onAuthFailure={() => void refresh()}
    >
      <AppShell />
    </SyncProvider>
  )
}

export interface AppProps {
  /** Injected by tests. Production builds construct the Supabase gateway. */
  gateway?: AuthGateway
}

export default function App({ gateway }: AppProps = {}) {
  // Building the gateway reads and validates .env, which throws if the app was
  // packaged without it. Fail with an instruction rather than a blank window —
  // this is the first thing anyone sees on a misconfigured build.
  const resolved = useMemo(() => {
    if (gateway) return { gateway, error: null as string | null }
    try {
      return { gateway: createSupabaseGateway(), error: null as string | null }
    } catch (cause) {
      return {
        gateway: null,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }, [gateway])

  if (!resolved.gateway) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">Not configured</h1>
          <p className="auth-error" role="alert">
            {resolved.error}
          </p>
          <p className="auth-subtitle">
            This build cannot reach the server. Copy .env.example to .env at the repository root,
            fill it in, and rebuild.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ToastProvider>
      <AuthProvider gateway={resolved.gateway}>
        <AuthGate />
      </AuthProvider>
    </ToastProvider>
  )
}
