/**
 * Identity types.
 *
 * FR-1.2 caches the session locally so the app opens offline, and NFR-S6 caches
 * the role with it. Neither is a security boundary: Supabase Row Level Security
 * is the enforcement layer at all times (PRD §3.1). A cached role decides what
 * this device draws; it grants nothing server-side.
 */

export type Role = 'owner' | 'manager' | 'accountant' | 'sales'

export const ROLES: readonly Role[] = ['owner', 'manager', 'accountant', 'sales']

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  accountant: 'Accountant',
  sales: 'Sales',
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** A row of public.profiles, as the app consumes it. */
export interface ProfileRecord {
  id: string
  fullName: string
  email: string
  phone: string | null
  role: Role
  isActive: boolean
  mustChangePassword: boolean
}

/** The signed-in user, as the shell consumes it. */
export interface Identity {
  userId: string
  fullName: string
  email: string
  role: Role
  mustChangePassword: boolean
}

export function identityFromProfile(profile: ProfileRecord): Identity {
  return {
    userId: profile.id,
    fullName: profile.fullName,
    email: profile.email,
    role: profile.role,
    mustChangePassword: profile.mustChangePassword,
  }
}
