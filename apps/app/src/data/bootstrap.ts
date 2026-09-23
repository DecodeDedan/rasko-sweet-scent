import { migrateLocalSchema } from './sqlite/schema.js'
import type { SqlDatabase } from './sqlite/types.js'
import { createSupabaseRemote } from './sync/supabaseRemote.js'
import type { SyncRemote } from './sync/remote.js'

export interface DeviceSync {
  db: SqlDatabase
  remote: SyncRemote
}

/**
 * The local database exists only inside the Tauri shell. A browser preview
 * (`vite preview`) and the test environment have no plugin to talk to, so the
 * sync layer reports `unavailable` rather than pretending.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Opens the device database and returns the sync pair, or null when not running
 * on a device.
 *
 * Both the plugin and the Supabase client are imported dynamically: a static
 * import would pull the Tauri IPC bindings into every bundle, including the one
 * `vite preview` serves in a plain browser.
 */
export async function openDeviceSync(): Promise<DeviceSync | null> {
  const { getSupabaseClient } = await import('../auth/supabaseGateway.js')

  if (isTauriRuntime()) {
    const { openTauriDatabase } = await import('./sqlite/tauriDatabase.js')
    const db = await openTauriDatabase()
    await migrateLocalSchema(db)
    return { db, remote: createSupabaseRemote(getSupabaseClient()) }
  }

  // Development in a plain browser: an in-memory WASM SQLite, so every data
  // screen works with HMR instead of needing a Rust rebuild. Never bundled into
  // a release — see browserDatabase.ts.
  //
  // Excluded under test: Vitest cannot resolve the .wasm asset, and tests build
  // their own database explicitly rather than going through this bootstrap.
  if (import.meta.env.DEV && !import.meta.env.TEST) {
    const { openBrowserDatabase } = await import('./sqlite/browserDatabase.js')
    const db = await openBrowserDatabase()
    await migrateLocalSchema(db)
    return { db, remote: createSupabaseRemote(getSupabaseClient()) }
  }

  return null
}
