'use client'

import { DatabaseZap, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusChip,
  Table,
  formatKes,
  formatPhone,
  useToast,
} from '@rasko/ui'

import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { ClientDetailDrawer } from './ClientDetailDrawer.js'
import { ClientForm } from './ClientForm.js'
import type { ClientFormValues } from './ClientForm.js'
import { ClientNotDeletableError } from './clientsRepository.js'
import { useClientList, useClientsRepository } from './useClients.js'
import { CLIENT_TYPES, CLIENT_TYPE_LABEL } from './types.js'
import type { Client, ClientDetail, ClientSort, ClientSummary, ClientType } from './types.js'

/** Client-side id, so a client created offline is complete before it syncs. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Older Android WebViews lack randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

export function ClientsScreen({ role, scope }: ScreenProps) {
  const repo = useClientsRepository()
  const { showToast } = useToast()

  const [search, setSearch] = useState('')
  const [type, setType] = useState<ClientType | 'all'>('all')
  const [sort, setSort] = useState<ClientSort>('name')

  const { clients, isLoading, error, reload } = useClientList({ search, type, sort })

  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Client | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ClientDetail | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Deleting is a manager/owner action (PRD §3.1); the server refuses it for
  // anyone else regardless of what this hides.
  const canDelete = role === 'owner' || role === 'manager'

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Clients" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="Clients are stored on the device. Run the installed application to see and edit them."
          />
        </Card>
      </div>
    )
  }

  async function handleCreate(values: ClientFormValues) {
    try {
      await repo!.create({ id: newId(), ...values } as never)
      showToast({
        tone: 'success',
        title: 'Client added',
        description: 'Saved on this device. It syncs when you are online.',
      })
      await reload()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not save the client.' }
    }
  }

  async function handleEdit(values: ClientFormValues) {
    if (!editing) return { error: 'Nothing to edit.' }
    try {
      await repo!.update(editing.id, values)
      showToast({ tone: 'success', title: 'Client updated' })
      await reload()
      return {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Could not save the client.' }
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setIsDeleting(true)
    try {
      await repo!.softDelete(pendingDelete.client.id)
      showToast({
        tone: 'success',
        title: 'Client deleted',
        description: 'Their history is kept and the deletion is recorded in the audit log.',
      })
      setPendingDelete(null)
      setDetailId(null)
      await reload()
    } catch (cause) {
      // FR-3.5. The same rule is enforced by a server trigger, so this message
      // explains rather than protects.
      showToast({
        tone: 'danger',
        title: 'Cannot delete this client',
        description:
          cause instanceof ClientNotDeletableError
            ? `${formatKes(cause.outstandingCents)} is still outstanding on their issued invoices.`
            : cause instanceof Error
              ? cause.message
              : 'Could not delete the client.',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const isFiltered = search.trim() !== '' || type !== 'all'

  const empty = (
    <EmptyState
      icon={<Users size={20} aria-hidden="true" />}
      title={isFiltered ? 'No clients match' : 'No clients yet'}
      description={
        isFiltered
          ? 'Search by name or phone number. Clear the filters to see every client.'
          : 'Add the people and businesses you sell to. Each one keeps its own order history, balance and credit terms.'
      }
      action={
        isFiltered ? (
          <Button
            onClick={() => {
              setSearch('')
              setType('all')
            }}
          >
            Clear filters
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setIsCreating(true)}>
            Add client
          </Button>
        )
      }
    />
  )

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Clients"
        description="Everyone the business sells to, with their balance and order history."
        meta={<ScopeBadge scope={scope} />}
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus size={15} aria-hidden="true" />}
            onClick={() => setIsCreating(true)}
          >
            Add client
          </Button>
        }
      />

      <div className="client-filters">
        <Input
          placeholder="Search by name or phone"
          aria-label="Search clients"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter by type"
          value={type}
          onChange={(event) => setType(event.target.value as ClientType | 'all')}
          options={[
            { value: 'all', label: 'All types' },
            ...CLIENT_TYPES.map((t) => ({ value: t, label: CLIENT_TYPE_LABEL[t] })),
          ]}
        />
        <Select
          aria-label="Sort by"
          value={sort}
          onChange={(event) => setSort(event.target.value as ClientSort)}
          options={[
            { value: 'name', label: 'Name' },
            { value: 'recent', label: 'Recent activity' },
            { value: 'outstanding', label: 'Outstanding' },
          ]}
        />
      </div>

      {error ? (
        <Card>
          <p style={{ color: 'var(--rasko-danger)' }}>{error}</p>
        </Card>
      ) : null}

      {isLoading ? (
        <Card>
          <p style={{ color: 'var(--rasko-text-secondary)' }}>Loading clients.</p>
        </Card>
      ) : (
        <>
          {/* Tables on desktop (PRD §7). */}
          <div className="rsk-desktop-only">
            <Card isFlush>
              <Table
                rows={clients}
                getRowKey={(client) => client.id}
                empty={empty}
                onRowSelect={(client) => setDetailId(client.id)}
                columns={[
                  { key: 'name', header: 'Name', render: (c) => c.name },
                  {
                    key: 'type',
                    header: 'Type',
                    render: (c) => (
                      <StatusChip tone="neutral">{CLIENT_TYPE_LABEL[c.client_type]}</StatusChip>
                    ),
                  },
                  {
                    key: 'phone',
                    header: 'Phone',
                    render: (c) => (c.phone ? formatPhone(c.phone) : '—'),
                  },
                  {
                    key: 'lifetime',
                    header: 'Lifetime',
                    isNumeric: true,
                    render: (c) => formatKes(c.lifetimeCents),
                  },
                  {
                    key: 'outstanding',
                    header: 'Outstanding',
                    isNumeric: true,
                    render: (c) => formatKes(c.outstandingCents),
                  },
                ]}
              />
            </Card>
          </div>

          {/* Cards on mobile. */}
          <div className="rsk-mobile-only rsk-stack">
            {clients.length === 0 ? <Card>{empty}</Card> : null}
            {clients.map((client: ClientSummary) => (
              <Card key={client.id}>
                <button
                  type="button"
                  className="client-card-button"
                  onClick={() => setDetailId(client.id)}
                >
                  <span className="rsk-row" style={{ justifyContent: 'space-between' }}>
                    <strong>{client.name}</strong>
                    <StatusChip tone="neutral">{CLIENT_TYPE_LABEL[client.client_type]}</StatusChip>
                  </span>
                  <span className="client-card-line">
                    {client.phone ? formatPhone(client.phone) : 'No phone number'}
                  </span>
                  <span className="client-card-line rsk-numeric">
                    {formatKes(client.outstandingCents)} outstanding
                  </span>
                </button>
              </Card>
            ))}
          </div>
        </>
      )}

      <ClientDetailDrawer
        clientId={detailId}
        repo={repo}
        canDelete={canDelete}
        onClose={() => setDetailId(null)}
        onEdit={(detail) => {
          setEditing(detail.client)
          setDetailId(null)
        }}
        onDelete={(detail) => setPendingDelete(detail)}
      />

      {isCreating ? (
        <ClientForm isOpen onClose={() => setIsCreating(false)} onSubmit={handleCreate} />
      ) : null}

      {editing ? (
        <ClientForm
          isOpen
          client={editing}
          onClose={() => setEditing(null)}
          onSubmit={handleEdit}
        />
      ) : null}

      {pendingDelete ? (
        <Modal
          isOpen
          onClose={() => setPendingDelete(null)}
          title="Delete this client"
          size="sm"
          footer={
            <>
              <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="danger" isLoading={isDeleting} onClick={handleDelete}>
                Delete
              </Button>
            </>
          }
        >
          <p>
            {pendingDelete.client.name} will be hidden from lists and pickers. Their orders,
            invoices and payments are kept, and the deletion is recorded in the audit log.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
