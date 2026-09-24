import { describe, expect, it } from 'vitest'

import { makeProfile } from '../../test/fakeGateway.js'
import { assignableRoles, rowControls } from '../userAdmin.js'

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
})
