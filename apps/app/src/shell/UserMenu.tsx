'use client'

import { ChevronDown, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@rasko/ui'

import { useAuth } from '../auth/AuthProvider.js'
import { ROLE_LABEL } from '../auth/session.js'
import { readConfigStatus } from '../env.js'

function initials(fullName: string): string {
  return fullName
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function UserMenu() {
  const { identity, signOut, isOffline } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  // Read once per mount: build-time values cannot change while the app runs.
  const [{ config }] = useState(readConfigStatus)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!identity) return null

  return (
    <div className="shell__user" ref={containerRef}>
      <button
        type="button"
        className="shell__user-trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="shell__avatar" aria-hidden="true">
          {initials(identity.fullName)}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
        <span className="rsk-visually-hidden">Account menu</span>
      </button>

      {isOpen ? (
        <div className="shell__user-popover">
          <p className="shell__user-name">{identity.fullName}</p>
          <p className="shell__user-email">{identity.email}</p>
          <p className="shell__user-email">{ROLE_LABEL[identity.role]}</p>

          <hr className="shell__user-divider" />

          <p className="shell__dev-label">
            {config ? `Environment: ${config.environment}` : 'Backend not configured'}
          </p>
          <p className="shell__user-email">
            {isOffline ? 'Offline — signed in from this device' : 'Connected'}
          </p>

          <hr className="shell__user-divider" />

          <Button
            variant="ghost"
            isFullWidth
            leadingIcon={<LogOut size={15} aria-hidden="true" />}
            isLoading={isSigningOut}
            onClick={() => {
              setIsSigningOut(true)
              void signOut()
            }}
          >
            Sign out
          </Button>
        </div>
      ) : null}
    </div>
  )
}
