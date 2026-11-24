import type { Role } from '../../auth/session.js'

export type DeliveryStatus = 'dispatched' | 'received' | 'cancelled'

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  dispatched: 'Awaiting intake',
  received: 'Intake recorded',
  cancelled: 'Cancelled',
}

/**
 * The reason codes printed on the pack house's "Outgrower product quality
 * check & receipt confirmation" sheet. The intake report quotes the number,
 * so the number is what is stored; the label is for reading it back.
 */
export const REJECTION_CODES: Readonly<Record<number, string>> = {
  1: 'Botrytis',
  2: 'Less buds',
  3: 'Broken stems',
  4: 'Thrips damage',
  5: 'Live mites',
  6: 'Moulds',
  7: 'White fly',
  8: 'Caterpillar',
  9: 'Head damage',
  10: 'Bruises',
  11: 'Mixed stages',
  12: 'Wrong box count',
  13: 'Wrong bunch count',
  14: 'Poor head levels',
  15: 'Petal damage',
  16: 'Breakages',
  17: 'Too open',
  18: 'Too tight',
  19: 'Chemical residue',
  20: 'Scorched leaves',
  21: 'Thrips damage (secondary)',
  22: 'Mite damage',
  23: 'Below bud spec',
  24: 'Poor defoliation',
  25: 'Pressure damage',
  26: 'Leaf damage',
  27: 'Leaf blackening',
  28: 'Leaf yellowing',
  29: 'Product on hold',
  30: 'Uneven stem cut',
  31: 'Dehydration',
  32: 'Length variation',
  33: 'Off-colour or off-type',
  34: 'Weak stems',
  35: 'Bent stems',
  36: 'Bent necks',
  37: 'Under weight',
  38: 'Temperature',
  39: 'Unapproved variety',
  40: 'Rotting',
  41: 'Poor packing',
  42: 'Loose strapping',
  43: 'No traceability',
  44: 'Browning',
  45: 'Petal blackening',
  46: 'Dry buds',
  47: 'Damage (other)',
}

export const REJECTION_CODE_NUMBERS: readonly number[] = Object.keys(REJECTION_CODES)
  .map(Number)
  .sort((a, b) => a - b)

export function rejectionLabel(code: number): string {
  return REJECTION_CODES[code] ?? `Code ${code}`
}

export interface DeliveryLine {
  id: string
  delivery_id: string
  product_id: string
  product_name: string
  unit: string
  stem_length_cm: number | null
  quantity_sent: number
  quantity_received: number | null
  rejected_primary: number
  rejected_secondary: number
  rejection_codes: number[]
  position: number
}

/** Accepted and short counts are derived, never stored. */
export interface LineOutcome {
  received: number
  rejected: number
  accepted: number
  short: number
}

export interface DeliverySummary {
  id: string
  client_id: string
  client_name: string
  delivery_date: string
  week: number
  delivery_note_number: string | null
  gatepass_number: string | null
  grn_number: string | null
  arrival_temp_c: number | null
  qc_officer: string | null
  packhouse_manager: string | null
  status: DeliveryStatus
  received_at: string | null
  order_id: string | null
  order_number: string | null
  wastage_recorded_at: string | null
  notes: string | null
  sent: number
  received: number
  rejected: number
  accepted: number
}

export interface DeliveryDetail extends DeliverySummary {
  lines: DeliveryLine[]
}

export interface DeliveryQuery {
  search?: string
  status?: DeliveryStatus | 'all'
}

export interface NewDeliveryLine {
  id: string
  productId: string
  stemLengthCm: number | null
  quantitySent: number
}

export interface NewDelivery {
  id: string
  clientId: string
  deliveryDate: string
  deliveryNoteNumber: string | null
  gatepassNumber: string | null
  notes: string | null
  lines: NewDeliveryLine[]
}

export interface IntakeLine {
  id: string
  quantityReceived: number
  rejectedPrimary: number
  rejectedSecondary: number
  rejectionCodes: number[]
}

export interface IntakeReport {
  grnNumber: string | null
  arrivalTempC: number | null
  qcOfficer: string | null
  packhouseManager: string | null
  lines: IntakeLine[]
}

/** Quality by variety over a period, for the pack house report. */
export interface QualityRow {
  product_id: string
  product_name: string
  sent: number
  received: number
  rejected_primary: number
  rejected_secondary: number
  accepted: number
  acceptance_rate: number
}

export interface ReasonRow {
  code: number
  label: string
  lines: number
}

/** Mirrors the pack house RLS: finance roles see, owner and manager write. */
export function canSeePackhouse(role: Role): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant'
}

export function canWritePackhouse(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export function lineOutcome(line: DeliveryLine): LineOutcome {
  const received = line.quantity_received ?? 0
  const rejected = line.rejected_primary + line.rejected_secondary
  return {
    received,
    rejected,
    accepted: Math.max(0, received - rejected),
    short: line.quantity_received === null ? 0 : Math.max(0, line.quantity_sent - received),
  }
}

/** ISO-8601 week number, as the pack house heads its sheet ("WEEK No: 46"). */
export function isoWeek(isoDate: string): number {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
}
