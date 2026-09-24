'use client'

import { Mail, Pencil } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Input,
  StatusChip,
  Table,
  Textarea,
  formatDateTime,
  useToast,
} from '@rasko/ui'

import { useIdentity } from '../../auth/AuthProvider.js'
import { useSyncedEffect } from '../../data/sync/useSyncedEffect.js'
// The exact composer the send-email function runs, so the preview is the email.
import { composeEmail } from '../../../../../supabase/functions/_shared/email/compose.js'
import logoDataUri from '../../../../website/public/email/rss-logo.png?inline'
import type { CompanyProfile } from '../settings/settingsRepository.js'
import { EMAIL_KIND_LABEL } from './EmailActivity.js'
import { TEMPLATE_PLACEHOLDERS } from './emailRepository.js'
import type { EmailTemplate } from './emailRepository.js'
import { useEmailHistory, useEmailRepository } from './useEmail.js'

// The preview frame inherits the app's CSP, which loads no remote images, so
// the logo is inlined there. Real emails load it from the website.
const PREVIEW_ASSET_BASE = 'https://preview.invalid'
const PREVIEW_LOGO = `${PREVIEW_ASSET_BASE}/email/rss-logo.png`

const RECORD_NOTE = `<p style="margin:0 0 20px;padding:14px 16px;border:1px dashed #CFE3CC;border-radius:8px;font-family:Manrope,Arial,sans-serif;font-size:13px;color:#5C5F58;">The record's details, line items, totals and payment instructions are added here when the email is sent.</p>`

type WordingPatch = Pick<EmailTemplate, 'subject' | 'heading' | 'body'>

export function EmailTemplatesPanel({
  profile,
  canEdit,
}: {
  profile: CompanyProfile | null
  canEdit: boolean
}) {
  const repo = useEmailRepository()
  const identity = useIdentity()
  const { showToast } = useToast()
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const { emails } = useEmailHistory('all')

  const load = useCallback(async () => {
    if (repo) setTemplates(await repo.templates())
  }, [repo])
  useSyncedEffect(load)

  async function save(patch: WordingPatch): Promise<string | null> {
    if (!repo || !editing) return 'Local storage is not available.'
    try {
      await repo.updateTemplate(editing.id, patch)
      showToast({ tone: 'success', title: 'Email wording saved', description: editing.label })
      setEditing(null)
      await load()
      return null
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Could not save the wording.'
    }
  }

  return (
    <div className="rsk-stack">
      <Card>
        <div className="rsk-stack">
          <div>
            <h2 className="settings-section-title">Client emails</h2>
            <p className="settings-section-text">
              The wording of each email the app sends to clients. The logo header, footer and
              signature are fixed so every email carries the brand; the invoice or order details are
              added automatically.
            </p>
          </div>
          <Table
            rows={templates}
            getRowKey={(t) => t.id}
            empty={
              <EmptyState
                icon={<Mail size={20} aria-hidden="true" />}
                title="Templates arrive with the first sync"
                description="Connect this device once and the email wording is downloaded."
              />
            }
            columns={[
              { key: 'label', header: 'Email', render: (t) => t.label },
              { key: 'subject', header: 'Subject', render: (t) => t.subject },
              {
                key: 'actions',
                header: '',
                render: (t) => (
                  <Button
                    size="sm"
                    leadingIcon={<Pencil size={14} aria-hidden="true" />}
                    onClick={() => setEditing(t)}
                  >
                    {canEdit ? 'Edit' : 'Preview'}
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <Card isFlush>
        <div className="settings-card-head">
          <h2 className="settings-section-title">Sent emails</h2>
        </div>
        <Table
          rows={emails}
          getRowKey={(e) => e.id}
          empty={
            <EmptyState
              icon={<Mail size={20} aria-hidden="true" />}
              title="No emails yet"
              description="Email an invoice, receipt or order from its record and it is listed here with its delivery status."
            />
          }
          columns={[
            { key: 'when', header: 'Queued', render: (e) => formatDateTime(e.created_at) },
            { key: 'kind', header: 'Email', render: (e) => EMAIL_KIND_LABEL[e.template_key] },
            { key: 'to', header: 'To', render: (e) => e.to_email },
            {
              key: 'status',
              header: 'Status',
              render: (e) =>
                e.status === 'sent' ? (
                  <StatusChip tone="success">Sent</StatusChip>
                ) : e.status === 'failed' ? (
                  <StatusChip tone="danger">Not sent</StatusChip>
                ) : (
                  <StatusChip tone="neutral">Waiting to send</StatusChip>
                ),
            },
            {
              key: 'error',
              header: 'Detail',
              render: (e) => (e.status === 'failed' ? (e.last_error ?? '') : ''),
            },
          ]}
        />
      </Card>

      {editing ? (
        <TemplateEditor
          template={editing}
          profile={profile}
          senderName={identity.fullName}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}

function TemplateEditor({
  template,
  profile,
  senderName,
  canEdit,
  onClose,
  onSave,
}: {
  template: EmailTemplate
  profile: CompanyProfile | null
  senderName: string
  canEdit: boolean
  onClose: () => void
  onSave: (patch: WordingPatch) => Promise<string | null>
}) {
  const [subject, setSubject] = useState(template.subject)
  const [heading, setHeading] = useState(template.heading)
  const [body, setBody] = useState(template.body)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Placeholders stay visible in the preview ({{invoice_number}}): honest about
  // what is filled in at send time, and a mistyped one shows at once.
  const preview = useMemo(() => {
    const { html } = composeEmail(
      { subject, heading, body },
      {
        vars: { company_name: profile?.company_name ?? 'Rasko Sweet Scent' },
        blocksHtml: template.key === 'message' ? '' : RECORD_NOTE,
        company: profile ?? { company_name: 'Rasko Sweet Scent' },
        senderName,
        assetBaseUrl: PREVIEW_ASSET_BASE,
      },
    )
    return html.replace(PREVIEW_LOGO, logoDataUri)
  }, [subject, heading, body, profile, senderName, template.key])

  function insertPlaceholder(name: string) {
    const token = `{{${name}}}`
    const area = bodyRef.current
    const start = area?.selectionStart ?? body.length
    const end = area?.selectionEnd ?? body.length
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`)
    requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  async function save() {
    setIsSaving(true)
    setError(await onSave({ subject, heading, body }))
    setIsSaving(false)
  }

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={template.label}
      description={canEdit ? 'Edit the wording. The preview updates as you type.' : 'Preview'}
      className="email-editor"
      footer={
        canEdit ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" isLoading={isSaving} onClick={() => void save()}>
              Save wording
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="email-editor__grid">
        <div className="rsk-stack">
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <Field label="Subject" isRequired>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Heading" isRequired>
            <Input
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Message" isRequired hint="A blank line starts a new paragraph.">
            <Textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              disabled={!canEdit}
            />
          </Field>
          {canEdit ? (
            <div>
              <p className="email-editor__label">Insert a detail</p>
              <div className="email-editor__chips">
                {TEMPLATE_PLACEHOLDERS[template.key].map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="email-editor__chip"
                    onClick={() => insertPlaceholder(name)}
                  >
                    {name.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <iframe
          className="email-editor__preview"
          title={`Preview of the ${template.label.toLowerCase()} email`}
          sandbox=""
          srcDoc={preview}
        />
      </div>
    </Drawer>
  )
}
