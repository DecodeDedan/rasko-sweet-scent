import { TABLES } from './tables.js'
import type { TableSpec } from './tables.js'
import type { SqlExecutor } from './types.js'

/**
 * One-time repair for the update bug shipped on 2026-11-06 (commit 37979a0).
 *
 * `Repository.updateWithinTransaction` merged the stored, already-encoded row
 * with the patch and encoded the result again. Two things followed on every
 * update:
 *
 *  1. The upload payload carried the raw row: a `sync_status` key the server
 *     has no column for, booleans as 0/1, JSON as text, and quantities in
 *     thousandths. PostgREST refuses an unknown column, so those uploads were
 *     parked in `outbox_dead`, along with any good row pushed in the same batch.
 *  2. The device's own copy of every quantity the patch did not touch was
 *     multiplied by 1000.
 *
 * Only that bug ever put `sync_status` in a payload (insert payloads and the
 * fixed update are built from table columns), so it is an exact signature.
 *
 * What the repair does:
 *  - A table with no quantity column: the device copy is intact, so the
 *    payload is rebuilt from the table's columns and queued again. The edit
 *    still reaches the server.
 *  - A table with a quantity column: the true quantity cannot be recovered
 *    from the payload (patched columns are decoded, untouched ones are not),
 *    so the edit is held back in `outbox_dead` with a plain explanation, and
 *    the table's pull cursor is cleared so the server's copy replaces the
 *    damaged local rows on the next sync.
 *  - A clean entry refused only because a bad one shared its batch is queued
 *    again unchanged.
 */

export const REPAIR_KEY = 'repair_20261106_encoded_updates'

export const HELD_BACK_MESSAGE =
  'Held back by the 6 November quantity repair. This change never reached the server and its quantities could not be trusted. Please make it again.'

export interface RepairResult {
  requeued: number
  rebuilt: number
  heldBack: number
  resetTables: string[]
}

interface Entry {
  seq: number
  entity_table: string
  entity_id: string
  op: string
  payload: string
  error?: string | null
  source: 'outbox' | 'dead'
}

const SPECS = new Map(TABLES.map((spec) => [spec.name, spec]))

function hasQuantity(spec: TableSpec): boolean {
  return spec.columns.some((column) => column.kind === 'qty')
}

function parse(payload: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Brings a mixed payload back to the server's shape. A column the patch set is
 * already decoded and a column it did not is still raw, so each kind accepts
 * both forms.
 */
function rebuild(spec: TableSpec, payload: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const column of spec.columns) {
    if (!(column.name in payload)) continue
    const value = payload[column.name]
    if (value === null || value === undefined) {
      clean[column.name] = null
      continue
    }
    switch (column.kind) {
      case 'bool':
        clean[column.name] = value === true || value === 1 || value === '1'
        break
      case 'json':
        if (typeof value === 'string') {
          const parsed = (() => {
            try {
              return JSON.parse(value) as unknown
            } catch {
              return value
            }
          })()
          clean[column.name] = parsed
        } else {
          clean[column.name] = value
        }
        break
      default:
        clean[column.name] = value
    }
  }
  return clean
}

async function requeue(tx: SqlExecutor, entry: Entry, payload: string, now: string): Promise<void> {
  if (entry.source === 'outbox') {
    await tx.execute(
      'UPDATE outbox SET payload = ?, attempts = 0, next_attempt_at = NULL, last_error = NULL WHERE seq = ?',
      [payload, entry.seq],
    )
    return
  }
  // outbox seq is AUTOINCREMENT and never reused, so the parked seq is free and
  // keeps the entry in its original order.
  await tx.execute(
    `INSERT INTO outbox (seq, entity_table, entity_id, op, payload, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [entry.seq, entry.entity_table, entry.entity_id, entry.op, payload, now],
  )
  await tx.execute('DELETE FROM outbox_dead WHERE seq = ?', [entry.seq])
}

async function holdBack(tx: SqlExecutor, entry: Entry, now: string): Promise<void> {
  if (entry.source === 'dead') {
    await tx.execute('UPDATE outbox_dead SET error = ? WHERE seq = ?', [
      HELD_BACK_MESSAGE,
      entry.seq,
    ])
    return
  }
  await tx.execute(
    `INSERT OR REPLACE INTO outbox_dead (seq, entity_table, entity_id, op, payload, error, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.seq,
      entry.entity_table,
      entry.entity_id,
      entry.op,
      entry.payload,
      HELD_BACK_MESSAGE,
      now,
    ],
  )
  await tx.execute('DELETE FROM outbox WHERE seq = ?', [entry.seq])
}

/** Runs once per device; later calls return null without touching anything. */
export async function repairEncodedPayloads(
  tx: SqlExecutor,
  now: string = new Date().toISOString(),
): Promise<RepairResult | null> {
  const done = await tx.select<{ value: string }>('SELECT value FROM local_meta WHERE key = ?', [
    REPAIR_KEY,
  ])
  if (done.length > 0) return null

  const queued = await tx.select<Omit<Entry, 'source'>>(
    'SELECT seq, entity_table, entity_id, op, payload FROM outbox ORDER BY seq',
  )
  const parked = await tx.select<Omit<Entry, 'source'>>(
    'SELECT seq, entity_table, entity_id, op, payload, error FROM outbox_dead ORDER BY seq',
  )
  const entries: Entry[] = [
    ...queued.map((row) => ({ ...row, source: 'outbox' as const })),
    ...parked.map((row) => ({ ...row, source: 'dead' as const })),
  ]

  const result: RepairResult = { requeued: 0, rebuilt: 0, heldBack: 0, resetTables: [] }

  for (const entry of entries) {
    const spec = SPECS.get(entry.entity_table)
    const payload = parse(entry.payload)
    if (!spec || !payload) continue

    if (!('sync_status' in payload)) {
      // Collateral: a good row refused only because its batch held a bad one.
      if (entry.source === 'dead' && /sync_status/.test(entry.error ?? '')) {
        await requeue(tx, entry, entry.payload, now)
        result.requeued += 1
      }
      continue
    }

    if (hasQuantity(spec)) {
      await holdBack(tx, entry, now)
      result.heldBack += 1
    } else {
      await requeue(tx, entry, JSON.stringify(rebuild(spec, payload)), now)
      result.rebuilt += 1
    }
  }

  // Every table with a quantity column is pulled again from the start, so a
  // damaged local copy is replaced by the server's even where no queued entry
  // remains to point at it. Rows still waiting to upload are skipped by the
  // pull, as always.
  for (const spec of TABLES) {
    if (!hasQuantity(spec) || spec.appendOnly) continue
    await tx.execute('DELETE FROM sync_state WHERE table_name = ?', [spec.name])
    result.resetTables.push(spec.name)
  }

  await tx.execute('INSERT INTO local_meta (key, value) VALUES (?, ?)', [
    REPAIR_KEY,
    JSON.stringify({ ...result, at: now }),
  ])
  return result
}

export const PUSH_ORDER_REPAIR_KEY = 'repair_20261124_push_order'

/**
 * One-time companion to the push-order fix of 2026-11-24 (advances now push
 * after payroll_runs; data/__tests__/syncOrder.test.ts guards the order).
 * Uploads the server refused because their parent row had not arrived yet
 * were parked as permanent failures. They are queued once more; a refusal
 * that was genuine is simply parked again on the next sync.
 */
export async function requeueForeignKeyRefusals(
  tx: SqlExecutor,
  now: string = new Date().toISOString(),
): Promise<number | null> {
  const done = await tx.select<{ value: string }>('SELECT value FROM local_meta WHERE key = ?', [
    PUSH_ORDER_REPAIR_KEY,
  ])
  if (done.length > 0) return null

  const refused = await tx.select<Omit<Entry, 'source'>>(
    `SELECT seq, entity_table, entity_id, op, payload, error FROM outbox_dead
     WHERE error LIKE '%violates foreign key constraint%' ORDER BY seq`,
  )
  for (const entry of refused) {
    await requeue(tx, { ...entry, source: 'dead' }, entry.payload, now)
  }

  await tx.execute('INSERT INTO local_meta (key, value) VALUES (?, ?)', [
    PUSH_ORDER_REPAIR_KEY,
    JSON.stringify({ requeued: refused.length, at: now }),
  ])
  return refused.length
}
