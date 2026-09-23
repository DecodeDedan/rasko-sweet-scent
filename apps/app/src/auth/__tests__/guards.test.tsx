import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from '../../App.js'
import { createFakeGateway, makeProfile } from '../../test/fakeGateway.js'
import { MODULES, modulesForRole } from '../../shell/navigation.js'
import type { ModuleId } from '../../shell/navigation.js'
import { ModuleGuard } from '../guards.js'
import { ROLES } from '../session.js'
import type { Role } from '../session.js'

/**
 * Route guards and role-driven navigation.
 *
 * The expectations below are derived from the PRD §3.1 matrix as encoded in
 * navigation.ts, not hard-coded a second time — a test that restates the matrix
 * by hand would pass happily while both copies drifted from the PRD.
 */

function signedInAs(role: Role) {
  return createFakeGateway({
    sessionUserId: `user-${role}`,
    profiles: [
      makeProfile({
        id: `user-${role}`,
        email: `${role}@raskosweetscent.example`,
        fullName: `Test ${role}`,
        role,
      }),
    ],
  })
}

describe('navigation is driven by role', () => {
  it.each(ROLES)('shows exactly the modules %s may reach', async (role) => {
    render(<App gateway={signedInAs(role)} />)
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    const sidebar = document.querySelector('.shell__sidebar') as HTMLElement
    const rendered = [...sidebar.querySelectorAll('.shell__nav-item')].map((n) => n.textContent)

    expect(rendered).toEqual(modulesForRole(role).map((m) => m.label))
  })

  it('hides suppliers, payroll, settings, users and audit from sales', async () => {
    render(<App gateway={signedInAs('sales')} />)
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    const sidebar = document.querySelector('.shell__sidebar') as HTMLElement
    const labels = [...sidebar.querySelectorAll('.shell__nav-item')].map((n) => n.textContent)

    for (const hidden of ['Suppliers', 'Payroll', 'Settings', 'Users', 'Audit log']) {
      expect(labels).not.toContain(hidden)
    }
  })

  it('gives user management to the owner alone (FR-1.4)', () => {
    expect(modulesForRole('owner').map((m) => m.id)).toContain('users')
    for (const role of ['manager', 'accountant', 'sales'] as const) {
      expect(modulesForRole(role).map((m) => m.id)).not.toContain('users')
    }
  })
})

describe('ModuleGuard blocks a forbidden module for every role', () => {
  const forbidden: Array<[Role, ModuleId]> = MODULES.flatMap((module) =>
    ROLES.filter((role) => !module.access[role].canAccess).map(
      (role) => [role, module.id] as [Role, ModuleId],
    ),
  )

  it('has forbidden combinations to check', () => {
    // Guards against the matrix accidentally becoming all-permissive: if this
    // ever hits zero, the loop below would silently assert nothing.
    expect(forbidden.length).toBeGreaterThan(0)
  })

  it.each(forbidden)('refuses %s access to %s', (role, moduleId) => {
    render(
      <ModuleGuard moduleId={moduleId} role={role}>
        <p>secret contents</p>
      </ModuleGuard>,
    )

    expect(screen.getByText('You do not have access to this')).toBeInTheDocument()
    expect(screen.queryByText('secret contents')).not.toBeInTheDocument()
  })

  it('renders the screen when the role is permitted', () => {
    render(
      <ModuleGuard moduleId="dashboard" role="sales">
        <p>dashboard contents</p>
      </ModuleGuard>,
    )

    expect(screen.getByText('dashboard contents')).toBeInTheDocument()
    expect(screen.queryByText('You do not have access to this')).not.toBeInTheDocument()
  })
})

describe('owner-only user management', () => {
  it('lets the owner open the Users screen', async () => {
    render(<App gateway={signedInAs('owner')} />)
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })

    const sidebar = document.querySelector('.shell__sidebar') as HTMLElement
    const labels = [...sidebar.querySelectorAll('.shell__nav-item')].map((n) => n.textContent)
    expect(labels).toContain('Users')
  })

  it('refuses the Users screen to a non-owner even if it is rendered directly', () => {
    render(
      <ModuleGuard moduleId="users" role="manager">
        <p>user list</p>
      </ModuleGuard>,
    )
    expect(screen.getByText('You do not have access to this')).toBeInTheDocument()
  })
})
