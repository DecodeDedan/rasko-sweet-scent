/**
 * The complete authentication and user-management surface the app uses.
 *
 * Every call the UI can make against Supabase Auth or the profiles table is
 * declared here and nowhere else. Two reasons:
 *
 *   1. It is a short, readable list of exactly what this client is able to do,
 *      which makes the security review of FR-1.x tractable.
 *   2. Tests substitute a fake implementation instead of mocking supabase-js
 *      internals, so the tests exercise real component logic.
 *
 * Nothing here is a security boundary. Every method maps onto a call the server
 * independently authorises through RLS (docs/architecture.md §5).
 */

import type { ProfileRecord, Role } from './session.js'

export interface GatewayResult {
  /** Human-readable failure, already safe to show. Absent on success. */
  error?: string
}

export interface AuthGateway {
  // ---- FR-1.1 / FR-1.2: sign in, sign out, restore -----------------------
  signIn(email: string, password: string): Promise<GatewayResult>
  signOut(): Promise<void>
  /** The user id of the persisted session, or null. Hits the network to refresh. */
  getSessionUserId(): Promise<string | null>
  /** Fires when Supabase refreshes, restores or drops a session. Returns an unsubscribe. */
  onAuthChange(handler: (userId: string | null) => void): () => void

  // ---- profile ------------------------------------------------------------
  fetchProfile(userId: string): Promise<ProfileRecord | null>

  // ---- FR-1.5 / FR-1.6: password ------------------------------------------
  requestPasswordReset(email: string): Promise<GatewayResult>
  updatePassword(newPassword: string): Promise<GatewayResult>
  clearMustChangePassword(userId: string): Promise<GatewayResult>

  // ---- FR-1.4: owner-only user management ---------------------------------
  listProfiles(): Promise<ProfileRecord[]>
  /** FR-1.3. The server refuses this for any non-owner; the UI only hides it. */
  changeRole(userId: string, role: Role): Promise<GatewayResult>
  /** FR-1.4 / T4. Revokes server access; also revokes the refresh token. */
  setActive(userId: string, isActive: boolean): Promise<GatewayResult>
  inviteUser(email: string, fullName: string, role: Role): Promise<GatewayResult>
}
