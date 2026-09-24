'use client'

import { Plus, UserX, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusChip,
  Table,
  useToast,
} from '@rasko/ui'

import { useAuth } from '../auth/AuthProvider.js'
import { NoAccess } from '../auth/guards.js'
import { ROLE_LABEL } from '../auth/session.js'
import type { ProfileRecord, Role } from '../auth/session.js'
import { assignableRoles, rowControls } from '../auth/userAdmin.js'
import type { ScreenProps } from './common.js'

/**
 * FR-1.4: owner-only user management — invite, set role, deactivate.
 *
 * Every mutation here is refused server-side for a non-owner (the
 * profiles_update_owner policy plus the profiles_guard_privileges trigger), and
 * every one of them writes an audit row through the profiles_audit_role trigger
 * (PRD §3). This screen is the convenient way to do it, not the thing that
 * permits it.
 */
export function UsersScreen({ role }: ScreenProps) {
  const { gateway, identity, refresh } = useAuth()
  const { showToast } = useToast()

  const [profiles, setProfiles] = useState<ProfileRecord[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('sales')
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [confirmTarget, setConfirmTarget] = useState<ProfileRecord | null>(null)

  const load = useCallback(async () => {
    try {
      setLoadError(null)
      setProfiles(await gateway.listProfiles())
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load users.')
    }
  }, [gateway])

  useEffect(() => {
    if (role === 'owner') void load()
  }, [load, role])

  // Belt and braces: navigation already hides this screen for non-owners.
  if (role !== 'owner' || !identity) return <NoAccess moduleLabel="user management" />

  const viewer = { userId: identity.userId, isSuperAdmin: identity.isSuperAdmin }
  const offeredRoles = assignableRoles(viewer)
  const roleOptions = (current: Role) =>
    (offeredRoles.includes(current) ? offeredRoles : [current, ...offeredRoles]).map((r) => ({
      value: r,
      label: ROLE_LABEL[r],
    }))

  async function handleRoleChange(profile: ProfileRecord, nextRole: Role) {
    if (nextRole === profile.role) return
    setBusyId(profile.id)
    const result = await gateway.changeRole(profile.id, nextRole)
    setBusyId(null)

    if (result.error) {
      showToast({ tone: 'danger', title: 'Role not changed', description: result.error })
      return
    }
    showToast({
      tone: 'success',
      title: 'Role changed',
      description: `${profile.fullName} is now ${ROLE_LABEL[nextRole].toLowerCase()}.`,
    })
    await load()
    // Changing your own role changes what this session may reach.
    if (profile.id === identity?.userId) await refresh()
  }

  async function handleSetActive(profile: ProfileRecord, isActive: boolean) {
    setBusyId(profile.id)
    const result = await gateway.setActive(profile.id, isActive)
    setBusyId(null)
    setConfirmTarget(null)

    if (result.error) {
      showToast({
        tone: 'danger',
        title: isActive ? 'Not reactivated' : 'Not deactivated',
        description: result.error,
      })
      return
    }
    showToast({
      tone: 'success',
      title: isActive ? 'User reactivated' : 'User deactivated',
      description: isActive
        ? `${profile.fullName} can sign in again.`
        : `${profile.fullName} loses access the next time their device reaches the server.`,
    })
    await load()
  }

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault()
    setInviteError(null)

    if (!inviteEmail.trim() || !inviteName.trim()) {
      setInviteError('Enter a name and an email address.')
      return
    }

    setIsInviting(true)
    const result = await gateway.inviteUser(inviteEmail, inviteName, inviteRole)
    setIsInviting(false)

    if (result.error) {
      setInviteError(result.error)
      return
    }

    setIsInviteOpen(false)
    setInviteEmail('')
    setInviteName('')
    setInviteRole('sales')
    showToast({
      tone: 'success',
      title: 'Invitation sent',
      description: 'They must choose their own password the first time they sign in.',
    })
    await load()
  }

  const rows = profiles ?? []

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Users"
        description="Who can sign in, what role they hold, and whether their access is still active."
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus size={15} aria-hidden="true" />}
            onClick={() => setIsInviteOpen(true)}
          >
            Invite user
          </Button>
        }
      />

      {loadError ? (
        <Card>
          <p style={{ color: 'var(--rasko-danger)' }}>{loadError}</p>
        </Card>
      ) : null}

      <Card isFlush>
        <Table
          rows={rows}
          getRowKey={(profile) => profile.id}
          empty={
            <EmptyState
              icon={<Users size={20} aria-hidden="true" />}
              title={profiles === null ? 'Loading users' : 'No users yet'}
              description={
                profiles === null
                  ? 'Reading the staff list from the server.'
                  : 'Invite the people who need access. Each one signs in with their own named account.'
              }
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (p) =>
                p.isSuperAdmin ? (
                  <span className="rsk-row">
                    {p.fullName} <StatusChip tone="success">Super admin</StatusChip>
                  </span>
                ) : (
                  p.fullName
                ),
            },
            { key: 'email', header: 'Email', render: (p) => p.email },
            {
              key: 'role',
              header: 'Role',
              width: '170px',
              render: (p) => (
                <Select
                  aria-label={`Role for ${p.fullName}`}
                  value={p.role}
                  disabled={busyId === p.id || !rowControls(viewer, p).canChangeRole}
                  onChange={(event) => void handleRoleChange(p, event.target.value as Role)}
                  options={roleOptions(p.role)}
                />
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (p) =>
                p.isActive ? (
                  <StatusChip tone="success">Active</StatusChip>
                ) : (
                  <StatusChip tone="muted">Deactivated</StatusChip>
                ),
            },
            {
              key: 'actions',
              header: '',
              render: (p) =>
                p.id === identity.userId ? (
                  <span style={{ color: 'var(--rasko-text-secondary)' }}>You</span>
                ) : !rowControls(viewer, p).canToggleActive ? (
                  <span style={{ color: 'var(--rasko-text-secondary)' }}>Protected</span>
                ) : p.isActive ? (
                  <Button
                    size="sm"
                    variant="danger"
                    leadingIcon={<UserX size={14} aria-hidden="true" />}
                    disabled={busyId === p.id}
                    onClick={() => setConfirmTarget(p)}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={busyId === p.id}
                    onClick={() => void handleSetActive(p, true)}
                  >
                    Reactivate
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      {/* Mounted only while open — see the note in LoginScreen. */}
      {isInviteOpen ? (
        <Modal
          isOpen={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
          title="Invite a user"
          description="They receive an email invitation and choose their own password on first sign-in."
          footer={
            <>
              <Button onClick={() => setIsInviteOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleInvite} isLoading={isInviting}>
                Send invitation
              </Button>
            </>
          }
        >
          <div className="rsk-stack">
            {inviteError ? (
              <p className="auth-error" role="alert">
                {inviteError}
              </p>
            ) : null}
            <Field label="Full name" isRequired>
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
            </Field>
            <Field label="Email" isRequired>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </Field>
            <Field label="Role" hint="You can change this later.">
              <Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                options={offeredRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
              />
            </Field>
          </div>
        </Modal>
      ) : null}

      {confirmTarget ? (
        <Modal
          isOpen={confirmTarget !== null}
          onClose={() => setConfirmTarget(null)}
          title="Deactivate this user"
          size="sm"
          footer={
            <>
              <Button onClick={() => setConfirmTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                isLoading={busyId === confirmTarget?.id}
                onClick={() => confirmTarget && void handleSetActive(confirmTarget, false)}
              >
                Deactivate
              </Button>
            </>
          }
        >
          <p>
            {confirmTarget?.fullName} will lose access as soon as their device reaches the server.
            Their history stays intact and they disappear from pickers. You can reactivate them at
            any time.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
