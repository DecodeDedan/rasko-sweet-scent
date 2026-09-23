import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadConfig } from '../env.js'
import type { AuthGateway, GatewayResult } from './gateway.js'
import { isRole } from './session.js'
import type { ProfileRecord, Role } from './session.js'

/**
 * Supabase-backed implementation of AuthGateway.
 *
 * FR-1.1 requires the PKCE flow. PKCE matters here specifically because this is
 * an installed application: it cannot hold a client secret, so the exchange is
 * protected by a per-attempt code verifier instead.
 */

let cached: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached

  const config = loadConfig()
  cached = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      // NFR-S6: the session is written to local storage so the app can open
      // offline after a restart (T5). It is cached data, not an authorisation.
      persistSession: true,
      autoRefreshToken: true,
      // Tauri serves the app from a custom protocol, not an OAuth redirect, so
      // there is never a session in the URL to detect.
      detectSessionInUrl: false,
      storageKey: 'rasko.auth.session',
    },
  })
  return cached
}

/** Maps a profiles row to the app's shape, rejecting anything malformed. */
function toProfile(row: Record<string, unknown>): ProfileRecord | null {
  const role = row['role']
  if (!isRole(role)) return null

  return {
    id: String(row['id']),
    fullName: String(row['full_name'] ?? ''),
    email: String(row['email'] ?? ''),
    phone: row['phone'] == null ? null : String(row['phone']),
    role,
    isActive: row['is_active'] === true,
    mustChangePassword: row['must_change_password'] === true,
  }
}

const PROFILE_COLUMNS = 'id, full_name, email, phone, role, is_active, must_change_password'

/**
 * Supabase surfaces "wrong password" and "no such user" as the same message on
 * purpose — distinguishing them would let an attacker enumerate accounts. This
 * keeps that property while making the rest readable.
 */
function friendlyAuthError(message: string): string {
  const normalised = message.toLowerCase()
  if (normalised.includes('invalid login credentials')) {
    return 'That email and password do not match. Check both and try again.'
  }
  if (normalised.includes('email not confirmed')) {
    return 'This account has not been confirmed yet. Check your email for the invitation.'
  }
  if (normalised.includes('failed to fetch') || normalised.includes('network')) {
    return 'Cannot reach the server. Check your internet connection and try again.'
  }
  return message
}

export function createSupabaseGateway(client: SupabaseClient = getSupabaseClient()): AuthGateway {
  return {
    async signIn(email, password): Promise<GatewayResult> {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      return error ? { error: friendlyAuthError(error.message) } : {}
    },

    async signOut() {
      await client.auth.signOut()
    },

    async getSessionUserId() {
      const { data, error } = await client.auth.getSession()
      if (error) throw error
      return data.session?.user.id ?? null
    },

    onAuthChange(handler) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        handler(session?.user.id ?? null)
      })
      return () => data.subscription.unsubscribe()
    },

    async fetchProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle()

      if (error) throw error
      return data ? toProfile(data as Record<string, unknown>) : null
    },

    async requestPasswordReset(email): Promise<GatewayResult> {
      // FR-1.5. The email itself is sent by the custom SMTP sender configured on
      // the Supabase project, not by Supabase's default sender — see
      // docs/auth-setup.md. redirectTo points at the marketing site because a
      // desktop app has no URL to land on.
      const config = loadConfig()
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: config.passwordResetUrl,
      })
      return error ? { error: friendlyAuthError(error.message) } : {}
    },

    async updatePassword(newPassword): Promise<GatewayResult> {
      const { error } = await client.auth.updateUser({ password: newPassword })
      return error ? { error: friendlyAuthError(error.message) } : {}
    },

    async clearMustChangePassword(userId): Promise<GatewayResult> {
      // Permitted by the profiles_update_self policy. The
      // profiles_guard_privileges trigger still blocks role and is_active here,
      // so this cannot be used to escalate.
      const { error } = await client
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', userId)

      return error ? { error: error.message } : {}
    },

    async listProfiles() {
      const { data, error } = await client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .order('full_name')

      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[])
        .map(toProfile)
        .filter((profile): profile is ProfileRecord => profile !== null)
    },

    async changeRole(userId, role: Role): Promise<GatewayResult> {
      // FR-1.3. If a non-owner reaches this, the server rejects it: the
      // profiles_update_owner policy does not match and the
      // profiles_guard_privileges trigger raises. The UI hiding the control is
      // convenience, not the control itself.
      const { error } = await client.from('profiles').update({ role }).eq('id', userId)
      return error ? { error: error.message } : {}
    },

    async setActive(userId, isActive): Promise<GatewayResult> {
      // FR-1.4 / T4. Two things must happen, and only the first is a table
      // write: flipping is_active makes every RLS policy stop matching for this
      // user, and revoking the refresh token stops their cached JWT being
      // renewed. The second needs the service key, so it runs in an edge
      // function — the key must never ship in the app (PRD §7).
      const { error } = await client.functions.invoke('set-user-active', {
        body: { userId, isActive },
      })
      return error ? { error: error.message } : {}
    },

    async inviteUser(email, fullName, role): Promise<GatewayResult> {
      // FR-1.4. Creating an auth user requires the service key, so this is an
      // edge function too. It sets must_change_password so the invited user is
      // forced to choose their own password on first login (FR-1.6).
      const { error } = await client.functions.invoke('invite-user', {
        body: { email: email.trim(), fullName: fullName.trim(), role },
      })
      return error ? { error: error.message } : {}
    },
  }
}
