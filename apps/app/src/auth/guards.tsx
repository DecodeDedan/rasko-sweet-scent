'use client'

import { ShieldOff } from 'lucide-react'
import { Button, Card, EmptyState } from '@rasko/ui'
import type { ReactNode } from 'react'

import { findModule } from '../shell/navigation.js'
import type { ModuleId } from '../shell/navigation.js'
import type { Role } from './session.js'

/**
 * Route guard for a module screen.
 *
 * Navigation already hides what a role cannot reach, so this fires only when
 * hiding was not enough: a role changed while the user was on the screen, or a
 * screen was reached some other way. It is a usability backstop, not the
 * security boundary — the server refuses the data regardless (PRD §3.1), so a
 * user who somehow renders a forbidden screen sees an empty one.
 */
export function ModuleGuard({
  moduleId,
  role,
  children,
}: {
  moduleId: ModuleId
  role: Role
  children: ReactNode
}) {
  const module = findModule(moduleId)
  if (module.access[role].canAccess) return <>{children}</>
  return <NoAccess moduleLabel={module.label} />
}

export function NoAccess({ moduleLabel }: { moduleLabel?: string }) {
  return (
    <Card>
      <EmptyState
        icon={<ShieldOff size={20} aria-hidden="true" />}
        title="You do not have access to this"
        description={
          moduleLabel
            ? `Your role does not include ${moduleLabel.toLowerCase()}. If you need it, ask the owner to change your role.`
            : 'Your role does not include this screen. If you need it, ask the owner to change your role.'
        }
      />
    </Card>
  )
}

/** Owner-only sections inside an otherwise permitted screen (FR-1.4). */
export function OwnerOnly({
  role,
  children,
  fallback,
}: {
  role: Role
  children: ReactNode
  fallback?: ReactNode
}) {
  if (role === 'owner') return <>{children}</>
  return <>{fallback ?? <NoAccess />}</>
}

/** Shown while the identity is being established, so no frame flashes a login
 *  form at a user who is already signed in. */
export function AuthLoading() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="rsk-spinner" aria-hidden="true" />
        <p className="auth-loading-text">Opening Rasko Sweet Scent</p>
      </div>
    </div>
  )
}

export function SignedOutError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p className="auth-error" role="alert">
          {message}
        </p>
        <Button variant="primary" isFullWidth onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}
