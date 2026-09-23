'use client'

import { StatusChip, useToast } from '@rasko/ui'
import type { StatusTone } from '@rasko/ui'

import type { Role } from '../auth/session.js'

export interface ScreenProps {
  role: Role
  /** The PRD §3.1 cell for this role and module. */
  scope: string
}

/**
 * Every screen here is a stub. Actions acknowledge the click rather than
 * pretending to work — a button that silently does nothing is worse than one
 * that says why.
 */
export function useNotBuiltYet(): (moduleName: string) => void {
  const { showToast } = useToast()
  return (moduleName: string) =>
    showToast({
      title: `${moduleName} is not built yet`,
      description: 'This screen is a shell. The module is built in a later session.',
    })
}

/** Shows the role's scope beside a page title when it is narrower than everything. */
export function ScopeBadge({ scope }: { scope: string }) {
  if (scope === 'All' || scope === 'Full') return null
  return <StatusChip tone="neutral">{scope}</StatusChip>
}

export interface InvoiceStatus {
  label: string
  tone: StatusTone
}

/**
 * Mirrors the `invoice_status` view in docs/architecture.md §3.1. Status is
 * derived from payments and today's date, never stored (FR-5.6).
 */
export function deriveInvoiceStatus(
  totalCents: number,
  paidCents: number,
  dueDate: string,
): InvoiceStatus {
  const balance = totalCents - paidCents
  if (balance <= 0) return { label: 'Paid', tone: 'success' }
  if (new Date(dueDate) < new Date()) return { label: 'Overdue', tone: 'danger' }
  if (paidCents > 0) return { label: 'Partially paid', tone: 'warning' }
  return { label: 'Unpaid', tone: 'neutral' }
}
