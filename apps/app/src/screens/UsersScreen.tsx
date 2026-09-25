'use client'

import { Mail, Plus, Trash2, UserX, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
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
import {
  assignableRoles,
  canAssignCompanyEmail,
  canDeleteAccount,
  rowControls,
} from '../auth/userAdmin.js'
import type { ScreenProps } from './common.js'
import { AssignCompanyEmailDialog, InviteUserDialog } from './users/CompanyEmailDialogs.js'
import { DeleteUserDialog } from './users/DeleteUserDialog.js'

/**
 * FR-1.4: owner-only user management — invite, set role, offboard, and (super
 * admin only) delete.
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
  const [assignTarget, setAssignTarget] = useState<ProfileRecord | null>(null)

  const [confirmTarget, setConfirmTarget] = useState<ProfileRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProfileRecord | null>(null)

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
        title: isActive ? 'Not reactivated' : 'Not offboarded',
        description: result.error,
      })
      return
    }
    showToast({
      tone: 'success',
      title: isActive ? 'User reactivated' : 'User offboarded',
      description: isActive
        ? `${profile.fullName} can sign in again.`
        : `${profile.fullName} is signed out everywhere and their company mail has stopped.`,
    })
    await load()
  }

  async function handleInvited(address: string) {
    setIsInviteOpen(false)
    showToast({
      tone: 'success',
      title: 'Invitation sent',
      description: `${address} is ready. The invitation went to their personal inbox.`,
    })
    await load()
  }

  async function handleAssigned(target: ProfileRecord, address: string, warning?: string) {
    setAssignTarget(null)
    showToast({
      tone: warning ? 'warning' : 'success',
      title: 'Company email created',
      description:
        warning ??
        `${target.id === identity?.userId ? 'You sign' : `${target.fullName} signs`} in with ${address} from now on.`,
    })
    await load()
    // Your own sign-in address is part of this session's identity.
    if (target.id === identity?.userId) await refresh()
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
            {
              key: 'email',
              header: 'Email',
              render: (p) =>
                canAssignCompanyEmail(viewer, p, gateway.staffEmailDomain) ? (
                  <span className="rsk-row">
                    {p.email}
                    <Button
                      size="sm"
                      leadingIcon={<Mail size={14} aria-hidden="true" />}
                      disabled={busyId === p.id}
                      onClick={() => setAssignTarget(p)}
                    >
                      Give company email
                    </Button>
                  </span>
                ) : (
                  p.email
                ),
            },
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
                    Offboard
                  </Button>
                ) : (
                  <span className="rsk-row">
                    <Button
                      size="sm"
                      disabled={busyId === p.id}
                      onClick={() => void handleSetActive(p, true)}
                    >
                      Reactivate
                    </Button>
                    {canDeleteAccount(viewer, p) ? (
                      <Button
                        size="sm"
                        variant="danger"
                        leadingIcon={<Trash2 size={14} aria-hidden="true" />}
                        disabled={busyId === p.id}
                        onClick={() => setDeleteTarget(p)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </span>
                ),
            },
          ]}
        />
      </Card>

      {/* Mounted only while open — see the note in LoginScreen. */}
      {isInviteOpen ? (
        <InviteUserDialog
          gateway={gateway}
          offeredRoles={offeredRoles}
          onClose={() => setIsInviteOpen(false)}
          onInvited={(address) => void handleInvited(address)}
        />
      ) : null}

      {assignTarget ? (
        <AssignCompanyEmailDialog
          gateway={gateway}
          target={assignTarget}
          isSelf={assignTarget.id === identity.userId}
          onClose={() => setAssignTarget(null)}
          onAssigned={(address, result) =>
            void handleAssigned(assignTarget, address, result.warning)
          }
        />
      ) : null}

      {confirmTarget ? (
        <Modal
          isOpen={confirmTarget !== null}
          onClose={() => setConfirmTarget(null)}
          title="Offboard this user"
          size="sm"
          footer={
            <>
              <Button onClick={() => setConfirmTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                isLoading={busyId === confirmTarget?.id}
                onClick={() => confirmTarget && void handleSetActive(confirmTarget, false)}
              >
                Offboard
              </Button>
            </>
          }
        >
          <ul className="rsk-stack">
            <li>{confirmTarget?.fullName} is signed out on every device and cannot sign in.</li>
            <li>Their company email stops receiving mail.</li>
            <li>Their device clears its copy of the business data the next time it connects.</li>
            <li>Their history stays intact. You can reactivate them at any time.</li>
          </ul>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <DeleteUserDialog
          gateway={gateway}
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            const name = deleteTarget.fullName
            setDeleteTarget(null)
            showToast({
              tone: 'success',
              title: 'Account deleted',
              description: `${name} can no longer sign in. Their name stays on their records.`,
            })
            void load()
          }}
        />
      ) : null}
    </div>
  )
}
