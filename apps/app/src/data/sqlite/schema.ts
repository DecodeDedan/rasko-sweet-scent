import { TABLES, cursorColumn } from './tables.js'
import type { ColumnKind, TableSpec } from './tables.js'
import type { SqlDatabase } from './types.js'

/** Local schema version. Bump when the generated DDL changes. */
export const SCHEMA_VERSION = 2

const SQLITE_TYPE: Record<ColumnKind, string> = {
  uuid: 'TEXT',
  text: 'TEXT',
  ts: 'TEXT',
  date: 'TEXT',
  json: 'TEXT',
  money: 'INTEGER',
  int: 'INTEGER',
  qty: 'INTEGER',
  bool: 'INTEGER',
}

/**
 * `sync_status` is local-only and never pushed. 'pending' means this row has an
 * unpushed local write; 'synced' means it matches what the server last sent.
 */
export type SyncStatus = 'pending' | 'synced'

function mirrorTableDdl(spec: TableSpec): string[] {
  const columns = spec.columns.map((column) => `  ${column.name} ${SQLITE_TYPE[column.kind]}`)
  columns.push(`  sync_status TEXT NOT NULL DEFAULT 'synced'`)

  const cursor = cursorColumn(spec)

  return [
    `CREATE TABLE IF NOT EXISTS ${spec.name} (\n${columns.join(',\n')},\n  PRIMARY KEY (id)\n)`,
    `CREATE INDEX IF NOT EXISTS ${spec.name}_cursor_idx ON ${spec.name} (${cursor}, id)`,
    `CREATE INDEX IF NOT EXISTS ${spec.name}_pending_idx ON ${spec.name} (sync_status)`,
  ]
}

/**
 * Local-only tables (architecture.md §9.2). Never synced, never pushed.
 */
const LOCAL_ONLY_DDL = [
  `CREATE TABLE IF NOT EXISTS outbox (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_table    TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  op              TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  payload         TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL
)`,
  // The pull loop asks "does this incoming row have a pending local write?" for
  // every row it receives, so this index is on the hot path.
  `CREATE INDEX IF NOT EXISTS outbox_entity_idx ON outbox (entity_table, entity_id)`,

  // Entries the server will never accept (a constraint or RLS refusal). Parked
  // here rather than retried forever, which would block every later write behind
  // one bad row.
  `CREATE TABLE IF NOT EXISTS outbox_dead (
  seq          INTEGER PRIMARY KEY,
  entity_table TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  op           TEXT NOT NULL,
  payload      TEXT NOT NULL,
  error        TEXT,
  failed_at    TEXT NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS sync_state (
  table_name        TEXT PRIMARY KEY,
  cursor_updated_at TEXT,
  cursor_id         TEXT,
  last_pulled_at    TEXT
)`,

  `CREATE TABLE IF NOT EXISTS local_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
)`,
]

export function schemaStatements(): string[] {
  return [...TABLES.flatMap(mirrorTableDdl), ...LOCAL_ONLY_DDL]
}

/**
 * Creates the local schema.
 *
 * NOTE: foreign keys are declared nowhere and `PRAGMA foreign_keys` is left OFF.
 * That is deliberate. A device holds a partial, eventually-consistent replica:
 * pulls run per table, so an order_item can arrive before its order, and a row
 * can reference a parent this role is not allowed to see at all. Enforcing
 * referential integrity here would reject legitimate rows. The server enforces
 * it (docs/architecture.md §2), which is the only place that sees the whole
 * picture.
 */
export async function migrateLocalSchema(db: SqlDatabase): Promise<void> {
  await db.transaction(async () => {
    for (const statement of schemaStatements()) {
      await db.execute(statement)
    }
    await db.execute(
      `INSERT INTO local_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [String(SCHEMA_VERSION)],
    )
  })
}
