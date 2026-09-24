import { ROLES } from './session.js'
import type { ProfileRecord, Role } from './session.js'

/**
 * What the Users screen offers, given who is looking at which row.
 *
 * Mirrors app.guard_profile_privileges (migration 20260924000100) and the
 * checks repeated in the invite-user and set-user-active functions. Change one
 * and change the others, or the screen offers a move the server then refuses.
 * The server is the control; this only keeps the screen honest.
 */
export interface RowControls {
  canChangeRole: boolean
  canToggleActive: boolean
}

export interface Viewer {
  userId: string
  isSuperAdmin: boolean
}

/** Only a super admin grants the owner role. */
export function assignableRoles(viewer: Viewer): readonly Role[] {
  return viewer.isSuperAdmin ? ROLES : ROLES.filter((role) => role !== 'owner')
}

export function rowControls(viewer: Viewer, target: ProfileRecord): RowControls {
  // Nobody locks themselves out, and an owner cannot step down from owner:
  // leaving the role is removing it, which only a super admin may do, and the
  // super admin must remain an owner (profiles_super_admin_is_owner).
  if (target.id === viewer.userId) return { canChangeRole: false, canToggleActive: false }

  if (target.isSuperAdmin && !viewer.isSuperAdmin) {
    return { canChangeRole: false, canToggleActive: false }
  }

  return {
    canChangeRole: target.isActive && (target.role !== 'owner' || viewer.isSuperAdmin),
    canToggleActive: true,
  }
}
