import { describe, expect, it } from 'vitest'

import { makeProfile } from '../../test/fakeGateway.js'
import {
  assignableRoles,
  canAssignCompanyEmail,
  canDeleteAccount,
  rowControls,
} from '../userAdmin.js'

const superAdmin = { userId: 'user-admin', isSuperAdmin: true }
const owner = { userId: 'user-owner', isSuperAdmin: false }

describe('user administration rules (mirrors app.guard_profile_privileges)', () => {
  it('offers the owner role only to the super admin', () => {
    expect(assignableRoles(superAdmin)).toContain('owner')
    expect(assignableRoles(owner)).toEqual(['manager', 'accountant', 'sales'])
  })

  it('locks the super admin row against an ordinary owner', () => {
    const target = makeProfile({ id: 'user-admin', isSuperAdmin: true })
    expect(rowControls(owner, target)).toEqual({ canChangeRole: false, canToggleActive: false })
  })

  it('lets an ordinary owner deactivate another owner but not change their role', () => {
    const target = makeProfile({ id: 'user-other-owner', role: 'owner' })
    expect(rowControls(owner, target)).toEqual({ canChangeRole: false, canToggleActive: true })
  })

  it('lets the super admin change any other row, owners included', () => {
    const target = makeProfile({ id: 'user-other-owner', role: 'owner' })
    expect(rowControls(superAdmin, target)).toEqual({ canChangeRole: true, canToggleActive: true })
  })

  it('never lets anyone change their own role or deactivate themselves', () => {
    const self = makeProfile({ id: 'user-admin', isSuperAdmin: true })
    expect(rowControls(superAdmin, self)).toEqual({ canChangeRole: false, canToggleActive: false })
  })

  it('does not offer a role change on a deactivated account', () => {
    const target = makeProfile({ id: 'user-sales', role: 'sales', isActive: false })
    expect(rowControls(owner, target).canChangeRole).toBe(false)
    expect(rowControls(owner, target).canToggleActive).toBe(true)
  })

  describe('company email (mirrors assign-company-email)', () => {
    const DOMAIN = 'raskosweetscent.com'

    it('offers it for an active account still on a personal address, your own included', () => {
      const other = makeProfile({ id: 'user-sales', email: 'jane@gmail.com' })
      const self = makeProfile({ id: 'user-admin', email: 'me@gmail.com', isSuperAdmin: true })
      expect(canAssignCompanyEmail(owner, other, DOMAIN)).toBe(true)
      expect(canAssignCompanyEmail(superAdmin, self, DOMAIN)).toBe(true)
    })

    it('does not offer it twice, or to a deactivated account', () => {
      const moved = makeProfile({ email: 'Jane.Kamau@RaskoSweetScent.com' })
      const gone = makeProfile({ email: 'jane@gmail.com', isActive: false })
      expect(canAssignCompanyEmail(owner, moved, DOMAIN)).toBe(false)
      expect(canAssignCompanyEmail(owner, gone, DOMAIN)).toBe(false)
    })

    it("keeps the super admin's address for the super admin alone", () => {
      const admin = makeProfile({ id: 'user-admin', email: 'me@gmail.com', isSuperAdmin: true })
      expect(canAssignCompanyEmail(owner, admin, DOMAIN)).toBe(false)
    })
  })

  describe('deleting an account (mirrors delete-user)', () => {
    it('is for the super admin alone, and only after offboarding', () => {
      const offboarded = makeProfile({ id: 'user-sales', role: 'sales', isActive: false })
      const active = makeProfile({ id: 'user-sales', role: 'sales' })
      expect(canDeleteAccount(superAdmin, offboarded)).toBe(true)
      expect(canDeleteAccount(superAdmin, active)).toBe(false)
      expect(canDeleteAccount(owner, offboarded)).toBe(false)
    })

    it('never offers the super admin account', () => {
      const admin = makeProfile({ id: 'user-admin', isSuperAdmin: true, isActive: false })
      expect(canDeleteAccount(superAdmin, admin)).toBe(false)
    })
  })
})
