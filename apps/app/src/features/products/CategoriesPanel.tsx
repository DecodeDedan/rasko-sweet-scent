'use client'

import { Tags } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, EmptyState, Field, Input, Modal, Table, useToast } from '@rasko/ui'

import type { ProductsRepository } from './productsRepository.js'
import type { Category } from './types.js'

interface CategoriesPanelProps {
  repo: ProductsRepository
  categories: readonly Category[]
  canWrite: boolean
  newId: () => string
  onChanged: () => Promise<void>
}

type Editing = { mode: 'create' } | { mode: 'rename'; category: Category }

/**
 * FR-6.1: every product belongs to a variety (a category row; migration
 * 20260926000100 seeds the four the farm grows). The list stays editable for
 * a fifth variety or a rename. Owner and manager only, like the rest of the
 * catalogue (PRD §3.1); the categories_write policy enforces it server-side.
 */
export function CategoriesPanel({
  repo,
  categories,
  canWrite,
  newId,
  onChanged,
}: CategoriesPanelProps) {
  const { showToast } = useToast()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  function open(next: Editing) {
    setEditing(next)
    setName(next.mode === 'rename' ? next.category.name : '')
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    setIsSaving(true)
    setError(null)
    try {
      if (editing.mode === 'create') await repo.createCategory(newId(), name)
      else await repo.renameCategory(editing.category.id, name)
      showToast({
        tone: 'success',
        title: editing.mode === 'create' ? 'Variety added' : 'Variety renamed',
      })
      setEditing(null)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the variety.')
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(category: Category) {
    setBusyId(category.id)
    try {
      await repo.removeCategory(category.id)
      showToast({ tone: 'success', title: 'Variety removed', description: category.name })
      await onChanged()
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Variety not removed',
        description: cause instanceof Error ? cause.message : 'Could not remove the variety.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rsk-stack">
      {canWrite && categories.length > 0 ? (
        <div className="rsk-row">
          <Button variant="primary" onClick={() => open({ mode: 'create' })}>
            Add variety
          </Button>
        </div>
      ) : null}

      <Card isFlush>
        <Table
          rows={categories}
          getRowKey={(c) => c.id}
          empty={
            <EmptyState
              icon={<Tags size={20} aria-hidden="true" />}
              title="No varieties yet"
              description={
                canWrite
                  ? 'Every product belongs to a variety, sold as standard or spray. Add one before adding products.'
                  : 'A manager or the owner adds varieties.'
              }
              action={
                canWrite ? (
                  <Button variant="primary" onClick={() => open({ mode: 'create' })}>
                    Add variety
                  </Button>
                ) : null
              }
            />
          }
          columns={[
            { key: 'name', header: 'Variety', render: (c) => c.name },
            ...(canWrite
              ? [
                  {
                    key: 'actions',
                    header: '',
                    render: (c: Category) => (
                      <div className="rsk-row">
                        <Button size="sm" onClick={() => open({ mode: 'rename', category: c })}>
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyId === c.id}
                          onClick={() => void remove(c)}
                        >
                          Remove
                        </Button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      {/* Mounted only while open (CLAUDE.md: closed dialogs duplicate labels). */}
      {editing ? (
        <Modal
          isOpen
          size="sm"
          onClose={() => setEditing(null)}
          title={editing.mode === 'create' ? 'Add a variety' : 'Rename variety'}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" isLoading={isSaving} onClick={save}>
                Save
              </Button>
            </>
          }
        >
          <form className="rsk-stack" onSubmit={save} noValidate>
            {error ? (
              <p className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <Field label="Name" isRequired>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}
