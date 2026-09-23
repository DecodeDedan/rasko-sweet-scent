'use client'

import { DatabaseZap, ScrollText } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusChip,
  Table,
  formatDateTime,
} from '@rasko/ui'

import { ScopeBadge } from '../../screens/common.js'
import type { ScreenProps } from '../../screens/common.js'
import { canSeeAuditLog } from './settingsRepository.js'
import type { AuditEntry } from './settingsRepository.js'
import { useSettingsRepository } from './useSettings.js'

/** Actions that change money or access are the ones worth spotting in a list. */
const SENSITIVE = new Set(['delete', 'void', 'reversal', 'role_change', 'payroll_approval'])

export function AuditLogScreen({ role, scope }: ScreenProps) {
  const repo = useSettingsRepository()

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [filters, setFilters] = useState<{ actions: string[]; tables: string[] }>({
    actions: [],
    tables: [],
  })
  const [action, setAction] = useState('all')
  const [entityTable, setEntityTable] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!repo || !canSeeAuditLog(role)) return
    try {
      setError(null)
      setEntries(
        await repo.auditLog({
          ...(action !== 'all' ? { action } : {}),
          ...(entityTable !== 'all' ? { entityTable } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        }),
      )
      setFilters(await repo.auditFilters())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the audit log.')
    }
  }, [repo, role, action, entityTable, from, to])

  useEffect(() => {
    void load()
  }, [load])

  if (!repo) {
    return (
      <div className="rsk-stack">
        <PageHeader title="Audit log" meta={<ScopeBadge scope={scope} />} />
        <Card>
          <EmptyState
            icon={<DatabaseZap size={20} aria-hidden="true" />}
            title="Local storage is not available here"
            description="The audit log is mirrored onto the device. Run the installed application to read it."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="rsk-stack">
      <PageHeader
        title="Audit log"
        description="Every sensitive change, with who made it and when. Written by the server; no device can alter it."
        meta={<ScopeBadge scope={scope} />}
      />

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <div className="rsk-stack">
          <Field label="Action">
            <Select
              value={action}
              onChange={(event) => setAction(event.target.value)}
              options={[
                { value: 'all', label: 'All actions' },
                ...filters.actions.map((value) => ({ value, label: value })),
              ]}
            />
          </Field>

          <Field label="Record type">
            <Select
              value={entityTable}
              onChange={(event) => setEntityTable(event.target.value)}
              options={[
                { value: 'all', label: 'All records' },
                ...filters.tables.map((value) => ({ value, label: value })),
              ]}
            />
          </Field>

          <Field label="From">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>

          <Field label="To">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card isFlush>
        <Table
          rows={entries}
          getRowKey={(entry) => entry.id}
          empty={
            <EmptyState
              icon={<ScrollText size={20} aria-hidden="true" />}
              title="Nothing recorded yet"
              description="Deletions, voided invoices, payment reversals, role changes and payroll approvals appear here."
            />
          }
          columns={[
            {
              key: 'when',
              header: 'When',
              render: (entry) => formatDateTime(entry.occurred_at),
            },
            { key: 'who', header: 'Who', render: (entry) => entry.actorName },
            {
              key: 'role',
              header: 'Role',
              render: (entry) => entry.actor_role ?? '—',
            },
            {
              key: 'action',
              header: 'Action',
              render: (entry) =>
                SENSITIVE.has(entry.action) ? (
                  <StatusChip tone="warning">{entry.action}</StatusChip>
                ) : (
                  <StatusChip tone="neutral">{entry.action}</StatusChip>
                ),
            },
            { key: 'table', header: 'Record', render: (entry) => entry.entity_table },
            {
              key: 'fields',
              header: 'Changed',
              render: (entry) =>
                entry.changed_fields && entry.changed_fields.length > 0
                  ? entry.changed_fields.join(', ')
                  : (entry.reason ?? '—'),
            },
          ]}
        />
      </Card>
    </div>
  )
}
