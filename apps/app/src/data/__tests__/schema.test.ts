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
})
