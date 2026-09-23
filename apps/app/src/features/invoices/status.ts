import type { InvoiceStatus, InvoiceStoredStatus } from './types.js'

/**
 * FR-5.6, mirroring the `invoice_status` view (architecture.md §3.1).
 *
 * Only draft / issued / voided are stored. Unpaid, partially paid, paid and
 * overdue are functions of the payments and today's date, so they are computed
 * here. Storing them would drift the moment a payment synced from another
 * device, and "overdue" would need a nightly job to stay true.
 */
export function deriveStatus(input: {
  stored: InvoiceStoredStatus
  balanceCents: number
  paidCents: number
  dueDate: string
  today?: Date
}): InvoiceStatus {
  if (input.stored === 'draft') return 'draft'
  if (input.stored === 'voided') return 'voided'
  if (input.balanceCents <= 0) return 'paid'

  const today = input.today ?? new Date()
  // Compare dates, not instants: an invoice due today is not overdue until the
  // day is out, wherever the device happens to be.
  if (input.dueDate < today.toISOString().slice(0, 10)) return 'overdue'

  if (input.paidCents > 0) return 'partially_paid'
  return 'unpaid'
}

export function daysOverdue(dueDate: string, today: Date = new Date()): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  const now = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(due) || now <= due) return 0
  return Math.floor((now - due) / 86_400_000)
}

export function statusTone(
  status: InvoiceStatus,
): 'neutral' | 'success' | 'warning' | 'danger' | 'muted' {
  switch (status) {
    case 'paid':
      return 'success'
    case 'overdue':
      return 'danger'
    case 'partially_paid':
      return 'warning'
    case 'draft':
    case 'voided':
      return 'muted'
    default:
      return 'neutral'
  }
}
