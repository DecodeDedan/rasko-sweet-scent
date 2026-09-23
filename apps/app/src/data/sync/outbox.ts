import type { SqlDatabase } from '../sqlite/types.js'

/**
 * The outbox: an ordered local journal of writes waiting to reach the server
 * (architecture.md §6.4, §9.2).
 */

export type OutboxOp = 'insert' | 'update' | 'delete'

export interface OutboxEntry {
  seq: number
  entityTable: string
  entityId: string
  op: OutboxOp
  payload: Record<string, unknown>
  attempts: number
}

interface OutboxRow {
  seq: number
  entity_table: string
  entity_id: string
  op: OutboxOp
  payload: string
  attempts: number
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    seq: row.seq,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    op: row.op,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    attempts: row.attempts,
  }
}

/**
 * Queues a write.
 *
 * Collapsing rule (architecture.md §9.2): an insert followed by edits to the
 * same still-unpushed row becomes ONE entry carrying the latest payload, keeping
 * its original queue position and op. Without this the queue grows with
 * keystrokes rather than with changed records, and "a day's work syncs in under
 * 10 s on 3G" (PRD §7) stops being achievable.
 */
export async function enqueue(
  db: SqlDatabase,
  entityTable: string,
  entityId: string,
  op: OutboxOp,
  payload: Record<string, unknown>,
  now: string = new Date().toISOString(),
): Promise<void> {
  const existing = await db.select<{ seq: number; op: OutboxOp }>(
    'SELECT seq, op FROM outbox WHERE entity_table = ? AND entity_id = ? ORDER BY seq LIMIT 1',
    [entityTable, entityId],
  )

  const first = existing[0]
  if (first) {
    // An insert that has not yet been pushed stays an insert: the server has
    // never seen this row, so sending an update would be wrong.
    await db.execute('UPDATE outbox SET payload = ?, last_error = NULL WHERE seq = ?', [
      JSON.stringify(payload),
      first.seq,
    ])
    return
  }

  await db.execute(
    `INSERT INTO outbox (entity_table, entity_id, op, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [entityTable, entityId, op, JSON.stringify(payload), now],
  )
}

export async function readBatch(db: SqlDatabase, limit = 500): Promise<OutboxEntry[]> {
  const rows = await db.select<OutboxRow>(
    `SELECT seq, entity_table, entity_id, op, payload, attempts
     FROM outbox ORDER BY seq LIMIT ?`,
    [limit],
  )
  return rows.map(toEntry)
}

export async function pendingCount(db: SqlDatabase): Promise<number> {
  const rows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM outbox')
  return Number(rows[0]?.n ?? 0)
}

/** Does this row have an unpushed local write? Consulted by the pull loop. */
export async function hasPending(
  db: SqlDatabase,
  entityTable: string,
  entityId: string,
): Promise<boolean> {
  const rows = await db.select<{ n: number }>(
    'SELECT COUNT(*) AS n FROM outbox WHERE entity_table = ? AND entity_id = ?',
    [entityTable, entityId],
  )
  return Number(rows[0]?.n ?? 0) > 0
}

export async function pendingIds(db: SqlDatabase, entityTable: string): Promise<Set<string>> {
  const rows = await db.select<{ entity_id: string }>(
    'SELECT entity_id FROM outbox WHERE entity_table = ?',
    [entityTable],
  )
  return new Set(rows.map((row) => row.entity_id))
}

export async function removeEntries(db: SqlDatabase, seqs: number[]): Promise<void> {
  if (seqs.length === 0) return
  const placeholders = seqs.map(() => '?').join(',')
  await db.execute(`DELETE FROM outbox WHERE seq IN (${placeholders})`, seqs)
}

export async function recordFailure(
  db: SqlDatabase,
  seqs: number[],
  message: string,
): Promise<void> {
  if (seqs.length === 0) return
  const placeholders = seqs.map(() => '?').join(',')
  await db.execute(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ?
     WHERE seq IN (${placeholders})`,
    [message, ...seqs],
  )
}

/** Parks an entry the server will never accept, so it stops blocking the queue. */
export async function moveToDead(
  db: SqlDatabase,
  entry: OutboxEntry,
  error: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO outbox_dead (seq, entity_table, entity_id, op, payload, error, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.seq,
      entry.entityTable,
      entry.entityId,
      entry.op,
      JSON.stringify(entry.payload),
      error,
      now,
    ],
  )
  await db.execute('DELETE FROM outbox WHERE seq = ?', [entry.seq])
}

export async function deadCount(db: SqlDatabase): Promise<number> {
  const rows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM outbox_dead')
  return Number(rows[0]?.n ?? 0)
}
