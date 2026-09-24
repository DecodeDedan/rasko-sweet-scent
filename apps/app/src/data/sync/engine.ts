import { encodeRow } from '../sqlite/codec.js'
import { TABLES, cursorColumn, isPullable, isPushable, tableSpec } from '../sqlite/tables.js'
import type { TableSpec } from '../sqlite/tables.js'
import type { SqlDatabase } from '../sqlite/types.js'
import { readCursor, writeCursor } from './cursors.js'
import { moveToDead, pendingIds, readBatch, recordFailure, removeEntries } from './outbox.js'
import type { OutboxEntry } from './outbox.js'
import { SyncAuthError, SyncTransportError } from './remote.js'
import type { SyncRemote } from './remote.js'

export interface SyncOutcome {
  pushed: number
  pulled: number
  dead: number
  /** Set when the server refused this device — the T4 signal. */
  authFailed: boolean
  error: string | null
  /** The server was a different database, so the local copy was started over. */
  replicaReset: boolean
}

export interface SyncOptions {
  pushBatch?: number
  pullPage?: number
  /** Safety cap so a misbehaving server cannot spin the pull loop forever. */
  maxPagesPerTable?: number
  now?: () => string
}

const DEFAULTS = { pushBatch: 200, pullPage: 500, maxPagesPerTable: 200 }

function upsertStatement(spec: TableSpec): string {
  const columns = spec.columns.map((column) => column.name)
  const placeholders = columns.map(() => '?').join(', ')

  if (spec.appendOnly) {
    // Append-only tables are never overwritten by a pull: the row cannot have
    // changed, and INSERT OR IGNORE makes a replayed page a no-op (T6).
    return `INSERT OR IGNORE INTO ${spec.name} (${columns.join(', ')}, sync_status)
            VALUES (${placeholders}, 'synced')`
  }

  // NFR-S4, server wins: every column is overwritten with what the server sent.
  const assignments = columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')

  return `INSERT INTO ${spec.name} (${columns.join(', ')}, sync_status)
          VALUES (${placeholders}, 'synced')
          ON CONFLICT (id) DO UPDATE SET ${assignments}, sync_status = 'synced'`
}

/**
 * Pushes one batch. Returns whether to continue, and whether anything moved.
 *
 * `progressed` guards the drain loop below: if a batch is neither accepted nor
 * permanently rejected — every row refused transiently — repeating it would spin
 * forever.
 */
async function pushBatch(
  db: SqlDatabase,
  remote: SyncRemote,
  outcome: SyncOutcome,
  options: Required<SyncOptions>,
): Promise<{ ok: boolean; progressed: boolean; drained: boolean }> {
  const entries = await readBatch(db, options.pushBatch)
  if (entries.length === 0) return { ok: true, progressed: false, drained: true }

  let progressed = false

  const byTable = new Map<string, OutboxEntry[]>()
  for (const entry of entries) {
    if (!isPushable(tableSpec(entry.entityTable))) continue
    const bucket = byTable.get(entry.entityTable) ?? []
    bucket.push(entry)
    byTable.set(entry.entityTable, bucket)
  }

  // Deterministic table order, so a failure part-way through is reproducible.
  for (const spec of TABLES) {
    const bucket = byTable.get(spec.name)
    if (!bucket || bucket.length === 0) continue

    const rows = bucket.map((entry) => entry.payload)

    let result
    try {
      result = await remote.push(spec.name, rows, {
        appendOnly: spec.appendOnly === true || spec.pushInsertOnly === true,
      })
    } catch (cause) {
      if (cause instanceof SyncAuthError) {
        outcome.authFailed = true
        outcome.error = cause.message
        return { ok: false, progressed, drained: false }
      }
      if (cause instanceof SyncTransportError) {
        outcome.error = cause.message
        await recordFailure(
          db,
          bucket.map((entry) => entry.seq),
          cause.message,
        )
        return { ok: false, progressed, drained: false }
      }
      throw cause
    }

    const rejectedById = new Map(result.rejected.map((rejection) => [rejection.id, rejection]))
    const accepted: number[] = []
    const acceptedIds: string[] = []

    for (const entry of bucket) {
      const rejection = rejectedById.get(entry.entityId)
      if (!rejection) {
        accepted.push(entry.seq)
        acceptedIds.push(entry.entityId)
        continue
      }
      if (rejection.permanent) {
        await moveToDead(db, entry, rejection.reason, options.now())
        outcome.dead += 1
        progressed = true
      } else {
        await recordFailure(db, [entry.seq], rejection.reason)
      }
    }

    if (accepted.length > 0) {
      await db.transaction(async (tx) => {
        await removeEntries(tx, accepted)
        const placeholders = acceptedIds.map(() => '?').join(', ')
        await tx.execute(
          `UPDATE ${spec.name} SET sync_status = 'synced' WHERE id IN (${placeholders})`,
          acceptedIds,
        )
      })
      outcome.pushed += accepted.length
      progressed = true
    }
  }

  return { ok: true, progressed, drained: false }
}

/**
 * Drains the outbox.
 *
 * A single batch is not enough: a device that has been offline for a day can
 * hold far more than one batch, and stopping after the first would leave the
 * rest queued until the next trigger fired — so a 400-row backlog would need
 * two cycles to clear, and a 4,000-row backlog twenty.
 */
async function pushPhase(
  db: SqlDatabase,
  remote: SyncRemote,
  outcome: SyncOutcome,
  options: Required<SyncOptions>,
): Promise<boolean> {
  for (;;) {
    const result = await pushBatch(db, remote, outcome, options)
    if (!result.ok) return false
    if (result.drained) return true
    if (!result.progressed) return true
  }
}

async function pullTable(
  db: SqlDatabase,
  remote: SyncRemote,
  spec: TableSpec,
  outcome: SyncOutcome,
  options: Required<SyncOptions>,
): Promise<boolean> {
  const statement = upsertStatement(spec)
  let cursor = await readCursor(db, spec.name)

  for (let page = 0; page < options.maxPagesPerTable; page += 1) {
    let result
    try {
      result = await remote.pull(spec.name, cursor, options.pullPage)
    } catch (cause) {
      if (cause instanceof SyncAuthError) {
        outcome.authFailed = true
        outcome.error = cause.message
        return false
      }
      if (cause instanceof SyncTransportError) {
        outcome.error = cause.message
        return false
      }
      throw cause
    }

    if (result.rows.length === 0) return true

    // Rows with an unpushed local write are left alone; they are overwritten by
    // the server on the cycle after their push lands. Push runs before pull, so
    // this window only opens for a write that arrives mid-cycle.
    const pending = await pendingIds(db, spec.name)

    await db.transaction(async (tx) => {
      for (const row of result.rows) {
        const id = String(row['id'] ?? '')
        if (pending.has(id)) continue
        const { values } = encodeRow(spec, row)
        await tx.execute(statement, values)
        outcome.pulled += 1
      }

      if (result.cursor) await writeCursor(tx, spec.name, result.cursor, options.now())
    })

    cursor = result.cursor
    if (!result.hasMore) return true
  }

  return true
}

const INSTANCE_KEY = 'server_instance'

/**
 * Before anything is pushed: is the server still the database this copy was
 * made from? If it has been replaced (migration 20260926000300), the local
 * rows, the unsent writes and the cursors all describe a database that no
 * longer exists. Pushing them would plant rows the new server never had, and
 * keeping them shows the user records that are not there. So the copy is
 * cleared and the pull that follows rebuilds it from the server.
 *
 * The first cycle after this check shipped has no stored id and simply
 * records the current one: it cannot tell a stale copy from a good one, and a
 * good one must never be thrown away on a guess.
 *
 * Returns false when the server cannot be reached, which ends the cycle the
 * same way a failed push would.
 */
async function ensureSameServer(
  db: SqlDatabase,
  remote: SyncRemote,
  outcome: SyncOutcome,
): Promise<boolean> {
  let current: string | null
  try {
    current = await remote.instanceId()
  } catch (cause) {
    if (cause instanceof SyncAuthError) {
      outcome.authFailed = true
      outcome.error = cause.message
      return false
    }
    if (cause instanceof SyncTransportError) {
      outcome.error = cause.message
      return false
    }
    throw cause
  }
  if (current === null) return true

  const [stored] = await db.select<{ value: string }>(
    'SELECT value FROM local_meta WHERE key = ?',
    [INSTANCE_KEY],
  )
  if (stored?.value === current) return true

  await db.transaction(async (tx) => {
    if (stored) {
      const localOnly = ['outbox', 'outbox_dead', 'sync_state']
      for (const table of [...TABLES.map((spec) => spec.name), ...localOnly]) {
        await tx.execute(`DELETE FROM ${table}`)
      }
    }
    await tx.execute(
      `INSERT INTO local_meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [INSTANCE_KEY, current],
    )
  })
  outcome.replicaReset = Boolean(stored)
  return true
}

/**
 * One sync cycle: push, then pull.
 *
 * The order is not arbitrary. Pulling first would let the server's copy
 * overwrite a local edit that has not been sent yet, destroying it silently.
 */
export async function runSync(
  db: SqlDatabase,
  remote: SyncRemote,
  options: SyncOptions = {},
): Promise<SyncOutcome> {
  const resolved: Required<SyncOptions> = {
    ...DEFAULTS,
    now: () => new Date().toISOString(),
    ...options,
  }

  const outcome: SyncOutcome = {
    pushed: 0,
    pulled: 0,
    dead: 0,
    authFailed: false,
    error: null,
    replicaReset: false,
  }

  if (!(await ensureSameServer(db, remote, outcome))) return outcome

  const pushed = await pushPhase(db, remote, outcome, resolved)
  if (!pushed) return outcome

  for (const spec of TABLES) {
    if (!isPullable(spec)) continue
    const ok = await pullTable(db, remote, spec, outcome, resolved)
    if (!ok) break
  }

  return outcome
}

/** Exposed for tests and diagnostics. */
export { upsertStatement, cursorColumn }
