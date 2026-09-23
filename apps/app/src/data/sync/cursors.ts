import type { SqlDatabase } from '../sqlite/types.js'
import type { PullCursor } from './remote.js'

/**
 * Per-table pull cursors (architecture.md §6.2). Device-local; never synced.
 */

export async function readCursor(db: SqlDatabase, table: string): Promise<PullCursor | null> {
  const rows = await db.select<{ cursor_updated_at: string | null; cursor_id: string | null }>(
    'SELECT cursor_updated_at, cursor_id FROM sync_state WHERE table_name = ?',
    [table],
  )
  const row = rows[0]
  if (!row?.cursor_updated_at || !row.cursor_id) return null
  return { value: row.cursor_updated_at, id: row.cursor_id }
}

/**
 * Advances the cursor.
 *
 * Called only after the page it describes is committed, and inside the same
 * transaction — so a crash mid-page re-fetches that page rather than losing it.
 */
export async function writeCursor(
  db: SqlDatabase,
  table: string,
  cursor: PullCursor,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db.execute(
    `INSERT INTO sync_state (table_name, cursor_updated_at, cursor_id, last_pulled_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (table_name) DO UPDATE SET
       cursor_updated_at = excluded.cursor_updated_at,
       cursor_id         = excluded.cursor_id,
       last_pulled_at    = excluded.last_pulled_at`,
    [table, cursor.value, cursor.id, now],
  )
}

export async function resetCursors(db: SqlDatabase): Promise<void> {
  await db.execute('DELETE FROM sync_state')
}
