import { vi } from 'vitest'

import type { AuthGateway, GatewayResult, InviteInput, PayoutWallet } from '../auth/gateway.js'
import type { ProfileRecord, Role } from '../auth/session.js'

export const STAFF_EMAIL_DOMAIN = 'raskosweetscent.com'

/**
 * An in-memory AuthGateway.
 *
 * Tests drive real component logic against this rather than mocking
 * supabase-js internals, so what is under test is the app's behaviour, not the
 * shape of a mock.
 */

export function makeProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: 'user-owner',
    fullName: 'Alice Tonui',
    email: 'owner@raskosweetscent.example',
    phone: null,
    role: 'owner',
    isActive: true,
    mustChangePassword: false,
    isSuperAdmin: false,
    ...overrides,
  }
}

export interface FakeGatewayOptions {
  profiles?: ProfileRecord[]
  /** Who is signed in at boot. Null means no persisted session. */
  sessionUserId?: string | null
  /** Makes every network-bound call reject, as an unreachable server would. */
  offline?: boolean
  password?: string
  /** What payoutWallet answers. Defaults to Daraja, which reports no balance. */
  wallet?: PayoutWallet | { error: string }
}

export interface FakeGateway extends AuthGateway {
  readonly calls: {
    signIn: Array<[string, string]>
    changeRole: Array<[string, Role]>
    setActive: Array<[string, boolean]>
    invite: InviteInput[]
    assign: Array<[string, string]>
    remove: string[]
    resetRequests: string[]
  }
  setOffline(value: boolean): void
  getProfiles(): ProfileRecord[]
}

export function createFakeGateway(options: FakeGatewayOptions = {}): FakeGateway {
  const profiles = [...(options.profiles ?? [makeProfile()])]
  let sessionUserId = options.sessionUserId === undefined ? null : options.sessionUserId
  let offline = options.offline ?? false
  const password = options.password ?? 'correct-horse'
  let listener: ((userId: string | null) => void) | null = null

  const calls: FakeGateway['calls'] = {
    signIn: [],
    changeRole: [],
    setActive: [],
    invite: [],
    assign: [],
    remove: [],
    resetRequests: [],
  }

  function networkGuard(): void {
    if (offline) throw new Error('Failed to fetch')
  }

  const gateway: FakeGateway = {
    calls,
    setOffline(value) {
      offline = value
    },
    getProfiles: () => profiles,

    async signIn(email, given): Promise<GatewayResult> {
      calls.signIn.push([email, given])
      if (offline) return { error: 'Cannot reach the server. Check your internet connection.' }

      const profile = profiles.find((p) => p.email === email.trim())
      if (!profile || given !== password) {
        return { error: 'That email and password do not match. Check both and try again.' }
      }
      sessionUserId = profile.id
      return {}
    },

    async signOut() {
      sessionUserId = null
      listener?.(null)
    },

    async getSessionUserId() {
      networkGuard()
      return sessionUserId
    },

    onAuthChange(handler) {
      listener = handler
      return () => {
        listener = null
      }
    },

    async fetchProfile(userId) {
      networkGuard()
      const profile = profiles.find((p) => p.id === userId)
      // A deactivated user's row is invisible to them under RLS, which is what
      // the real server returns.
      if (!profile || !profile.isActive) return null
      return { ...profile }
    },

    async requestPasswordReset(email) {
      calls.resetRequests.push(email)
      return offline ? { error: 'Cannot reach the server.' } : {}
    },

    async updatePassword() {
      networkGuard()
      return {}
    },

    async clearMustChangePassword(userId) {
      const profile = profiles.find((p) => p.id === userId)
      if (profile) profile.mustChangePassword = false
      return {}
    },

    async listProfiles() {
      networkGuard()
      return profiles.map((p) => ({ ...p }))
    },

    async changeRole(userId, role) {
      calls.changeRole.push([userId, role])
      networkGuard()
      const profile = profiles.find((p) => p.id === userId)
      if (profile) profile.role = role
      return {}
    },

    async setActive(userId, isActive) {
      calls.setActive.push([userId, isActive])
      networkGuard()
      const profile = profiles.find((p) => p.id === userId)
      if (profile) profile.isActive = isActive
      return {}
    },

    staffEmailDomain: STAFF_EMAIL_DOMAIN,

    async inviteUser(input) {
      calls.invite.push(input)
      networkGuard()
      const email = `${input.localPart}@${STAFF_EMAIL_DOMAIN}`
      profiles.push(
        makeProfile({
          id: `user-${email}`,
          email,
          fullName: input.fullName,
          role: input.role,
          mustChangePassword: true,
        }),
      )
      return {}
    },

    async deleteUser(userId) {
      calls.remove.push(userId)
      networkGuard()
      const index = profiles.findIndex((p) => p.id === userId)
      if (index >= 0) profiles.splice(index, 1)
      return {}
    },

    async assignCompanyEmail(userId, localPart) {
      calls.assign.push([userId, localPart])
      networkGuard()
      const index = profiles.findIndex((p) => p.id === userId)
      const current = profiles[index]
      if (current) profiles[index] = { ...current, email: `${localPart}@${STAFF_EMAIL_DOMAIN}` }
      return {}
    },

    async payoutWallet() {
      networkGuard()
      return options.wallet ?? { provider: 'daraja' }
    },
  }

  return gateway
}

/** Spy-wrapped variant for assertions on call counts. */
export function spyGateway(gateway: AuthGateway): AuthGateway {
  return {
    ...gateway,
    signIn: vi.fn(gateway.signIn),
    signOut: vi.fn(gateway.signOut),
  }
}
