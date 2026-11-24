import { Repository } from '../../data/repositories/repository.js'
import type { WriteContext } from '../../data/repositories/repository.js'
import type { SqlDatabase } from '../../data/sqlite/types.js'
import type { Role } from '../../auth/session.js'
import type { NewOrderInput } from '../orders/ordersRepository.js'
import {
  REJECTION_CODES,
  canSeePackhouse,
  canWritePackhouse,
  isoWeek,
  lineOutcome,
  rejectionLabel,
} from './types.js'
import type {
  DeliveryDetail,
  DeliveryLine,
  DeliveryQuery,
  DeliveryStatus,
  DeliverySummary,
  IntakeReport,
  NewDelivery,
  QualityRow,
  ReasonRow,
} from './types.js'

/**
 * Pack house deliveries and their intake QC (migration 20261124000300).
 *
 * ## What the device decides and what it derives
 *
 * The device stores what the pack house reported: sent, received and the two
 * rejection counts per line. Accepted and short are computed on read
 * (`lineOutcome`), so a corrected count can never leave a stale total behind.
 *
 * ## Settling a delivery
 *
 * Settling turns the intake into the two things the rest of the system
 * already understands: an order for the accepted stems (stock leaves through
 * the normal sale path and the order invoices as usual, FR-4.6), and wastage
 * movements for rejected and short stems. Each half is guarded by its own
 * column (`order_id`, `wastage_recorded_at`), so settling twice, or retrying
 * after one half failed, never duplicates either.
 */

export class PackhouseRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackhouseRuleError'
  }
}

/** Quantities are stored as thousandths (architecture.md §9.1). */
const SCALE = 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The collaborator that writes orders; OrdersRepository satisfies it. */
export interface OrderWriter {
  create(input: NewOrderInput): Promise<{ id: string; order_number?: string | null }>
  findSummary(id: string): Promise<{ id: string } | null>
}

/**
 * A UUID derived from a seed, the same on every device. Settling uses it for
 * the order, its lines and the wastage movements, so a retry after a partial
 * failure finds what it already wrote, and two devices settling the same
 * delivery offline write the same rows (stock_movements pushes ignore
 * duplicates), instead of each adding its own.
 */
export async function derivedId(seed: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rasko:${seed}`)),
  )
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  // RFC 9562 version 8 (custom) with the RFC variant bits.
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const SUMMARY_SELECT = `
  SELECT d.*,
         COALESCE(c.name, 'Unknown client') AS client_name,
         o.order_number                      AS order_number,
         COALESCE(t.sent, 0)                 AS sent_raw,
         COALESCE(t.received, 0)             AS received_raw,
         COALESCE(t.rejected, 0)             AS rejected_raw
  FROM packhouse_deliveries d
  LEFT JOIN clients c ON c.id = d.client_id
  LEFT JOIN orders o ON o.id = d.order_id
  LEFT JOIN (
    SELECT delivery_id,
           SUM(quantity_sent)                            AS sent,
           SUM(COALESCE(quantity_received, 0))           AS received,
           SUM(rejected_primary + rejected_secondary)    AS rejected
    FROM packhouse_delivery_lines WHERE deleted_at IS NULL GROUP BY delivery_id
  ) t ON t.delivery_id = d.id
`

function qty(value: unknown): number {
  return Number(value ?? 0) / SCALE
}

function parseCodes(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isInteger)
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isInteger) : []
  } catch {
    // A malformed array is shown as "no codes" rather than failing the whole screen.
    return []
  }
}

function toSummary(row: Record<string, unknown>): DeliverySummary {
  const received = qty(row['received_raw'])
  const rejected = qty(row['rejected_raw'])
  const temp = row['arrival_temp_c']
  return {
    id: String(row['id']),
    client_id: String(row['client_id']),
    client_name: String(row['client_name']),
    delivery_date: String(row['delivery_date']),
    week: isoWeek(String(row['delivery_date'])),
    delivery_note_number: (row['delivery_note_number'] as string | null) ?? null,
    gatepass_number: (row['gatepass_number'] as string | null) ?? null,
    grn_number: (row['grn_number'] as string | null) ?? null,
    arrival_temp_c: temp === null || temp === undefined ? null : qty(temp),
    qc_officer: (row['qc_officer'] as string | null) ?? null,
    packhouse_manager: (row['packhouse_manager'] as string | null) ?? null,
    status: row['status'] as DeliveryStatus,
    received_at: (row['received_at'] as string | null) ?? null,
    order_id: (row['order_id'] as string | null) ?? null,
    order_number: (row['order_number'] as string | null) ?? null,
    wastage_recorded_at: (row['wastage_recorded_at'] as string | null) ?? null,
    notes: (row['notes'] as string | null) ?? null,
    sent: qty(row['sent_raw']),
    received,
    rejected,
    accepted: Math.max(0, received - rejected),
  }
}

function requireCount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new PackhouseRuleError(`Enter ${label} as zero or more stems.`)
  }
}

export class PackhouseRepository {
  private readonly deliveries: Repository<Record<string, unknown>>
  private readonly lines: Repository<Record<string, unknown>>
  private readonly movements: Repository<Record<string, unknown>>

  constructor(
    private readonly db: SqlDatabase,
    private readonly role: Role,
    private readonly context: WriteContext,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.deliveries = new Repository(db, 'packhouse_deliveries', context)
    this.lines = new Repository(db, 'packhouse_delivery_lines', context)
    this.movements = new Repository(db, 'stock_movements', context)
  }

  private requireSee(): void {
    if (!canSeePackhouse(this.role)) {
      throw new PackhouseRuleError('This role cannot see pack house deliveries.')
    }
  }

  private requireWrite(): void {
    if (!canWritePackhouse(this.role)) {
      throw new PackhouseRuleError('Only an owner or manager can record pack house deliveries.')
    }
  }

  // ---------------------------------------------------------------- reads

  async list(query: DeliveryQuery = {}): Promise<DeliverySummary[]> {
    this.requireSee()
    const clauses = ['d.deleted_at IS NULL']
    const params: unknown[] = []
    if (query.status && query.status !== 'all') {
      clauses.push('d.status = ?')
      params.push(query.status)
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`
      clauses.push(
        `(LOWER(c.name) LIKE ? OR LOWER(COALESCE(d.delivery_note_number, '')) LIKE ?
          OR LOWER(COALESCE(d.gatepass_number, '')) LIKE ?
          OR LOWER(COALESCE(d.grn_number, '')) LIKE ?)`,
      )
      params.push(term, term, term, term)
    }
    // ponytail: newest 500; add paging when a season holds more deliveries than that.
    const rows = await this.db.select<Record<string, unknown>>(
      `${SUMMARY_SELECT} WHERE ${clauses.join(' AND ')}
       ORDER BY d.delivery_date DESC, d.created_at DESC LIMIT 500`,
      params,
    )
    return rows.map(toSummary)
  }

  async detail(id: string): Promise<DeliveryDetail | null> {
    this.requireSee()
    const [row] = await this.db.select<Record<string, unknown>>(
      `${SUMMARY_SELECT} WHERE d.id = ? AND d.deleted_at IS NULL`,
      [id],
    )
    if (!row) return null
    const lineRows = await this.db.select<Record<string, unknown>>(
      `SELECT l.*, COALESCE(p.name, 'Unknown product') AS product_name,
              COALESCE(p.unit, 'stem') AS unit
       FROM packhouse_delivery_lines l
       LEFT JOIN products p ON p.id = l.product_id
       WHERE l.delivery_id = ? AND l.deleted_at IS NULL
       ORDER BY l.position`,
      [id],
    )
    const lines: DeliveryLine[] = lineRows.map((line) => ({
      id: String(line['id']),
      delivery_id: String(line['delivery_id']),
      product_id: String(line['product_id']),
      product_name: String(line['product_name']),
      unit: String(line['unit']),
      stem_length_cm: line['stem_length_cm'] === null ? null : Number(line['stem_length_cm']),
      quantity_sent: qty(line['quantity_sent']),
      quantity_received: line['quantity_received'] === null ? null : qty(line['quantity_received']),
      rejected_primary: qty(line['rejected_primary']),
      rejected_secondary: qty(line['rejected_secondary']),
      rejection_codes: parseCodes(line['rejection_codes']),
      position: Number(line['position'] ?? 0),
    }))
    return { ...toSummary(row), lines }
  }

  /** Buyers to deliver to: every active client. */
  async clients(): Promise<Array<{ id: string; name: string }>> {
    return this.db.select<{ id: string; name: string }>(
      `SELECT id, name FROM clients WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    )
  }

  async products(): Promise<Array<{ id: string; name: string; unit: string }>> {
    return this.db.select<{ id: string; name: string; unit: string }>(
      `SELECT id, name, unit FROM products
       WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name COLLATE NOCASE`,
    )
  }

  // --------------------------------------------------------------- writes

  async create(input: NewDelivery): Promise<void> {
    this.requireWrite()
    if (!input.clientId) throw new PackhouseRuleError('Choose the pack house.')
    if (!ISO_DATE.test(input.deliveryDate)) throw new PackhouseRuleError('Enter the delivery date.')
    if (input.lines.length === 0) throw new PackhouseRuleError('Add at least one variety.')
    for (const line of input.lines) {
      if (!line.productId) throw new PackhouseRuleError('Choose a variety on every line.')
      if (!Number.isFinite(line.quantitySent) || line.quantitySent <= 0) {
        throw new PackhouseRuleError('Enter the stems on the delivery note for every line.')
      }
      if (
        line.stemLengthCm !== null &&
        (!Number.isInteger(line.stemLengthCm) || line.stemLengthCm < 1 || line.stemLengthCm > 300)
      ) {
        throw new PackhouseRuleError('Enter the stem length in whole centimetres.')
      }
    }

    await this.db.transaction(async (tx) => {
      await this.deliveries.insertWithinTransaction(tx, {
        id: input.id,
        client_id: input.clientId,
        delivery_date: input.deliveryDate,
        delivery_note_number: input.deliveryNoteNumber?.trim() || null,
        gatepass_number: input.gatepassNumber?.trim() || null,
        status: 'dispatched',
        notes: input.notes?.trim() || null,
      })
      let position = 0
      for (const line of input.lines) {
        position += 1
        await this.lines.insertWithinTransaction(tx, {
          id: line.id,
          delivery_id: input.id,
          product_id: line.productId,
          stem_length_cm: line.stemLengthCm,
          quantity_sent: line.quantitySent,
          rejected_primary: 0,
          rejected_secondary: 0,
          rejection_codes: [],
          position,
        })
      }
    })
    this.context.onLocalWrite?.()
  }

  /** Records (or corrects, before settling) the pack house's intake report. */
  async recordIntake(id: string, report: IntakeReport): Promise<void> {
    this.requireWrite()
    const delivery = await this.detail(id)
    if (!delivery) throw new PackhouseRuleError('Delivery not found on this device.')
    if (delivery.status === 'cancelled') {
      throw new PackhouseRuleError('This delivery was cancelled.')
    }
    if (delivery.order_id || delivery.wastage_recorded_at) {
      throw new PackhouseRuleError(
        'This intake is already settled into an order and stock. Correct the order instead.',
      )
    }
    if (
      report.arrivalTempC !== null &&
      (!Number.isFinite(report.arrivalTempC) ||
        report.arrivalTempC < -10 ||
        report.arrivalTempC > 50)
    ) {
      throw new PackhouseRuleError('Enter the arrival temperature in degrees Celsius.')
    }

    const byId = new Map(report.lines.map((line) => [line.id, line]))
    for (const line of delivery.lines) {
      const entry = byId.get(line.id)
      if (!entry) throw new PackhouseRuleError(`Enter the intake for ${line.product_name}.`)
      requireCount(entry.quantityReceived, 'the quantity received')
      requireCount(entry.rejectedPrimary, 'the primary rejections')
      requireCount(entry.rejectedSecondary, 'the secondary rejections')
      if (entry.rejectedPrimary + entry.rejectedSecondary > entry.quantityReceived) {
        throw new PackhouseRuleError(
          `${line.product_name}: more stems rejected than were received.`,
        )
      }
      const unknown = entry.rejectionCodes.find((code) => !(code in REJECTION_CODES))
      if (unknown !== undefined) {
        throw new PackhouseRuleError(`Reason code ${unknown} is not on the intake sheet.`)
      }
      if (
        entry.rejectedPrimary + entry.rejectedSecondary > 0 &&
        entry.rejectionCodes.length === 0
      ) {
        throw new PackhouseRuleError(
          `${line.product_name}: give the reason code for the rejections.`,
        )
      }
    }

    await this.db.transaction(async (tx) => {
      for (const line of delivery.lines) {
        const entry = byId.get(line.id)!
        await this.lines.updateWithinTransaction(tx, line.id, {
          quantity_received: entry.quantityReceived,
          rejected_primary: entry.rejectedPrimary,
          rejected_secondary: entry.rejectedSecondary,
          rejection_codes: [...new Set(entry.rejectionCodes)].sort((a, b) => a - b),
        })
      }
      await this.deliveries.updateWithinTransaction(tx, id, {
        grn_number: report.grnNumber?.trim() || null,
        arrival_temp_c: report.arrivalTempC,
        qc_officer: report.qcOfficer?.trim() || null,
        packhouse_manager: report.packhouseManager?.trim() || null,
        status: 'received',
        received_at: delivery.received_at ?? this.clock(),
      })
    })
    this.context.onLocalWrite?.()
  }

  async cancel(id: string): Promise<void> {
    this.requireWrite()
    const delivery = await this.detail(id)
    if (!delivery) throw new PackhouseRuleError('Delivery not found on this device.')
    if (delivery.order_id || delivery.wastage_recorded_at) {
      throw new PackhouseRuleError(
        'A settled delivery cannot be cancelled. Cancel its order instead.',
      )
    }
    await this.deliveries.update(id, { status: 'cancelled', received_at: null })
  }

  /**
   * Raises the order for accepted stems and books rejected and short stems as
   * wastage. Prices come from the catalogue in shillings; a buyer paid in
   * another currency has the order's prices set on the order afterwards.
   */
  async settle(
    id: string,
    orders: OrderWriter,
  ): Promise<{ orderId: string | null; wastageLines: number }> {
    this.requireWrite()
    const delivery = await this.detail(id)
    if (!delivery) throw new PackhouseRuleError('Delivery not found on this device.')
    if (delivery.status !== 'received') {
      throw new PackhouseRuleError('Record the pack house intake before settling the delivery.')
    }

    const prices = await this.db.select<{ id: string; selling: number; cost: number }>(
      `SELECT id, selling_price_cents AS selling, cost_price_cents AS cost FROM products
       WHERE id IN (${delivery.lines.map(() => '?').join(', ')})`,
      delivery.lines.map((line) => line.product_id),
    )
    const priceOf = new Map(prices.map((row) => [row.id, row]))
    const reference =
      delivery.delivery_note_number ?? delivery.gatepass_number ?? delivery.id.slice(0, 8)

    let orderId = delivery.order_id
    if (!orderId) {
      const accepted = delivery.lines.filter((line) => lineOutcome(line).accepted > 0)
      const derivedOrderId = await derivedId(`packhouse-order:${delivery.id}`)
      if (accepted.length > 0 && (await orders.findSummary(derivedOrderId))) {
        // An earlier attempt wrote the order but not the link.
        orderId = derivedOrderId
        await this.deliveries.update(id, { order_id: orderId })
      } else if (accepted.length > 0) {
        const lineKeys = await Promise.all(
          accepted.map((line) => derivedId(`packhouse-order-line:${line.id}`)),
        )
        const created = await orders.create({
          id: derivedOrderId,
          clientId: delivery.client_id,
          isWalkIn: false,
          orderType: 'standard',
          deliveryAt: `${delivery.delivery_date}T06:00:00.000Z`,
          deliveryAddress: null,
          deliveryNumber: delivery.delivery_note_number,
          eventDate: null,
          eventVenue: null,
          eventSetupNotes: null,
          notes: `Accepted stems from pack house delivery ${reference}, week ${delivery.week}.`,
          takenBy: this.context.userId ?? '',
          discountCents: 0,
          lines: accepted.map((line, index) => ({
            key: lineKeys[index]!,
            productId: line.product_id,
            description: line.stem_length_cm
              ? `${line.product_name}, ${line.stem_length_cm} cm`
              : line.product_name,
            quantity: String(lineOutcome(line).accepted),
            unitPrice: String(priceOf.get(line.product_id)?.selling ?? 0),
          })),
        })
        orderId = created.id
        await this.deliveries.update(id, { order_id: orderId })
      }
    }

    let wastageLines = 0
    if (!delivery.wastage_recorded_at) {
      const now = this.clock()
      const movementIds = new Map<string, string>()
      for (const line of delivery.lines) {
        for (const kind of ['rejected', 'short'] as const) {
          movementIds.set(
            `${line.id}:${kind}`,
            await derivedId(`packhouse-wastage:${line.id}:${kind}`),
          )
        }
      }
      await this.db.transaction(async (tx) => {
        for (const line of delivery.lines) {
          const outcome = lineOutcome(line)
          const cost = priceOf.get(line.product_id)?.cost ?? 0
          const book = async (kind: 'rejected' | 'short', stems: number, reason: string) => {
            if (stems <= 0) return
            wastageLines += 1
            await this.movements.insertWithinTransaction(tx, {
              id: movementIds.get(`${line.id}:${kind}`)!,
              product_id: line.product_id,
              movement_type: 'wastage',
              quantity: -stems,
              unit_cost_cents: cost,
              source_table: 'manual',
              source_id: null,
              reason,
              occurred_at: now,
            })
          }
          const codes = line.rejection_codes.map((code) => `${code} ${rejectionLabel(code)}`)
          await book(
            'rejected',
            outcome.rejected,
            `Pack house rejection, delivery ${reference}${codes.length ? `: ${codes.join(', ')}` : ''}`,
          )
          await book(
            'short',
            outcome.short,
            `Short on receipt at pack house, delivery ${reference}`,
          )
        }
        await this.deliveries.updateWithinTransaction(tx, id, { wastage_recorded_at: now })
      })
      this.context.onLocalWrite?.()
    }

    return { orderId, wastageLines }
  }

  // -------------------------------------------------------------- reports

  /** Acceptance by variety for deliveries received in a period. */
  async quality(from: string, to: string): Promise<QualityRow[]> {
    this.requireSee()
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT l.product_id, COALESCE(p.name, 'Unknown product') AS product_name,
              SUM(l.quantity_sent) AS sent,
              SUM(COALESCE(l.quantity_received, 0)) AS received,
              SUM(l.rejected_primary) AS rejected_primary,
              SUM(l.rejected_secondary) AS rejected_secondary
       FROM packhouse_delivery_lines l
       JOIN packhouse_deliveries d ON d.id = l.delivery_id
       LEFT JOIN products p ON p.id = l.product_id
       WHERE l.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status = 'received'
         AND d.delivery_date BETWEEN ? AND ?
       GROUP BY l.product_id, p.name
       ORDER BY sent DESC`,
      [from, to],
    )
    return rows.map((row) => {
      const received = qty(row['received'])
      const primary = qty(row['rejected_primary'])
      const secondary = qty(row['rejected_secondary'])
      const accepted = Math.max(0, received - primary - secondary)
      return {
        product_id: String(row['product_id']),
        product_name: String(row['product_name']),
        sent: qty(row['sent']),
        received,
        rejected_primary: primary,
        rejected_secondary: secondary,
        accepted,
        acceptance_rate: received > 0 ? accepted / received : 0,
      }
    })
  }

  /** How often each reason code was given on a received line in a period. */
  async reasons(from: string, to: string): Promise<ReasonRow[]> {
    this.requireSee()
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT l.rejection_codes AS codes
       FROM packhouse_delivery_lines l
       JOIN packhouse_deliveries d ON d.id = l.delivery_id
       WHERE l.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status = 'received'
         AND d.delivery_date BETWEEN ? AND ?`,
      [from, to],
    )
    const counts = new Map<number, number>()
    for (const row of rows) {
      for (const code of parseCodes(row['codes'])) counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([code, lines]) => ({ code, label: rejectionLabel(code), lines }))
      .sort((a, b) => b.lines - a.lines || a.code - b.code)
  }
}
