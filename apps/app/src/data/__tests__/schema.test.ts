import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../sqlite/schema.js'
import { TABLES, cursorColumn } from '../sqlite/tables.js'
import type { SqlDatabase } from '../sqlite/types.js'

describe('local schema', () => {
  let db: SqlDatabase

  beforeEach(async () => {
    db = openNodeDatabase()
    await migrateLocalSchema(db)
  })

  it('creates every mirrored table plus the local-only ones', async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    const names = rows.map((r) => r.name)

    for (const table of TABLES) expect(names).toContain(table.name)
    for (const local of ['outbox', 'outbox_dead', 'sync_state', 'local_meta']) {
      expect(names).toContain(local)
    }
  })

  it('gives every mirrored table a sync_status column', async () => {
    for (const table of TABLES) {
      const columns = await db.select<{ name: string }>(`PRAGMA table_info(${table.name})`)
      expect(columns.map((c) => c.name)).toContain('sync_status')
    }
  })

  it('gives every table a cursor column that actually exists', async () => {
    // The first version of this spec paged audit_log on created_at, which that
    // table does not have. A generated schema hides that until it runs.
    for (const table of TABLES) {
      const columns = await db.select<{ name: string }>(`PRAGMA table_info(${table.name})`)
      expect(columns.map((c) => c.name)).toContain(cursorColumn(table))
    }
  })

  it('is idempotent, so a relaunch re-runs it safely', async () => {
    await expect(migrateLocalSchema(db)).resolves.toBeUndefined()
  })

  it('widens a table an older build created, and re-pulls it so old rows fill in', async () => {
    const old = openNodeDatabase()
    // A device from before migration 20260926000100: products without stem_form,
    // and a pull cursor already past every product row.
    await old.execute(
      `CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT, name TEXT, sync_status TEXT NOT NULL DEFAULT 'synced')`,
    )
    await old.execute(`INSERT INTO products (id, sku, name) VALUES ('p1', 'BB-1', 'Baby Blue')`)
    await old.execute(
      `CREATE TABLE sync_state (table_name TEXT PRIMARY KEY, cursor_updated_at TEXT, cursor_id TEXT, last_pulled_at TEXT)`,
    )
    await old.execute(
      `INSERT INTO sync_state (table_name, cursor_updated_at) VALUES ('products', '2026-09-20T00:00:00Z'), ('clients', '2026-09-20T00:00:00Z')`,
    )

    await migrateLocalSchema(old)

    const columns = await old.select<{ name: string }>(
      `SELECT name FROM pragma_table_info('products')`,
    )
    expect(columns.map((c) => c.name)).toContain('stem_form')
    expect(await old.select(`SELECT id FROM products`)).toHaveLength(1)
    const cursors = await old.select<{ table_name: string }>(`SELECT table_name FROM sync_state`)
    expect(cursors.map((c) => c.table_name)).toEqual(['clients'])
    await old.close()
  })
})
