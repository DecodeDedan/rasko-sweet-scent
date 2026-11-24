import { beforeEach, describe, expect, it } from 'vitest'

import { openNodeDatabase } from '../sqlite/nodeDatabase.js'
import {
  HELD_BACK_MESSAGE,
  PUSH_ORDER_REPAIR_KEY,
  REPAIR_KEY,
  repairEncodedPayloads,
  requeueForeignKeyRefusals,
} from '../sqlite/repairEncodedPayloads.js'
import { migrateLocalSchema } from '../sqlite/schema.js'
import type { SqlDatabase } from '../sqlite/types.js'

const TS = '2026-11-10T08:00:00.000Z'
const REFUSED = "Could not find the 'sync_status' column of 'orders' in the schema cache"

/** Exactly what the 6 November code queued: the raw stored row plus the patch. */
async function buggyPayload(
  db: SqlDatabase,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const [raw] = await db.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [
    id,
  ])
  return JSON.stringify({ ...raw, ...patch, id })
}

async function park(
  db: SqlDatabase,
  seq: number,
  table: string,
  id: string,
  op: string,
  payload: string,
  error: string,
) {
  await db.execute(
    `INSERT INTO outbox_dead (seq, entity_table, entity_id, op, payload, error, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [seq, table, id, op, payload, error, TS],
  )
}

describe('the 6 November encoded-update repair', () => {
  let db: SqlDatabase

  beforeEach(async () => {
    db = openNodeDatabase()
    await migrateLocalSchema(db)
    // migrateLocalSchema already ran the repair on an empty device; run it again here.
    await db.execute('DELETE FROM local_meta WHERE key = ?', [REPAIR_KEY])

    await db.execute(
      `INSERT INTO orders (id, client_id, is_walk_in, status, total_cents, currency,
                           created_at, updated_at, sync_status)
       VALUES ('o1', 'c1', 1, 'confirmed', 500000, 'KES', ?, ?, 'synced')`,
      [TS, TS],
    )
    await db.execute(
      `INSERT INTO invoices (id, client_id, status, client_snapshot, total_cents, currency,
                             created_at, updated_at, sync_status)
       VALUES ('i1', 'c1', 'draft', '{"name":"Kabuku Packhouse"}', 500000, 'KES', ?, ?, 'synced')`,
      [TS, TS],
    )
    // low_stock_threshold 10 stems, stored as thousandths.
    await db.execute(
      `INSERT INTO products (id, sku, name, unit, low_stock_threshold, is_active,
                             created_at, updated_at, sync_status)
       VALUES ('p1', 'BB', 'Baby Blue', 'stem', 10000, 1, ?, ?, 'synced')`,
      [TS, TS],
    )
    await db.execute(
      `INSERT INTO sync_state (table_name, cursor_updated_at, cursor_id) VALUES ('products', ?, 'p1')`,
      [TS],
    )

    await park(
      db,
      5,
      'orders',
      'o1',
      'update',
      await buggyPayload(db, 'orders', 'o1', { status: 'delivered' }),
      REFUSED,
    )
    await park(
      db,
      6,
      'clients',
      'c9',
      'insert',
      JSON.stringify({ id: 'c9', name: 'New buyer' }),
      REFUSED,
    )
    await park(
      db,
      7,
      'clients',
      'c8',
      'insert',
      JSON.stringify({ id: 'c8', name: 'Bad phone' }),
      'violates check constraint',
    )
    await db.execute(
      `INSERT INTO outbox (seq, entity_table, entity_id, op, payload, created_at) VALUES (8, 'invoices', 'i1', 'update', ?, ?)`,
      [await buggyPayload(db, 'invoices', 'i1', { status: 'issued' }), TS],
    )
    await db.execute(
      `INSERT INTO outbox (seq, entity_table, entity_id, op, payload, created_at) VALUES (9, 'products', 'p1', 'update', ?, ?)`,
      [await buggyPayload(db, 'products', 'p1', { name: 'Baby Blue spray' }), TS],
    )
  })

  it('rebuilds edits whose tables hold no quantities and sends them again', async () => {
    const result = await repairEncodedPayloads(db, TS)
    expect(result).toMatchObject({ rebuilt: 2, requeued: 1, heldBack: 1 })

    const queued = await db.select<{ seq: number; payload: string }>(
      'SELECT seq, payload FROM outbox ORDER BY seq',
    )
    expect(queued.map((row) => row.seq)).toEqual([5, 6, 8])

    const order = JSON.parse(queued[0]!.payload) as Record<string, unknown>
    expect(order).not.toHaveProperty('sync_status')
    expect(order).toMatchObject({ status: 'delivered', is_walk_in: true, total_cents: 500000 })

    const invoice = JSON.parse(queued[2]!.payload) as Record<string, unknown>
    expect(invoice['client_snapshot']).toEqual({ name: 'Kabuku Packhouse' })
    expect(invoice['status']).toBe('issued')
  })

  it('holds back an edit with untrustworthy quantities and re-pulls its table', async () => {
    await repairEncodedPayloads(db, TS)

    const [held] = await db.select<{ error: string }>('SELECT error FROM outbox_dead WHERE seq = 9')
    expect(held?.error).toBe(HELD_BACK_MESSAGE)
    const cursors = await db.select<{ table_name: string }>('SELECT table_name FROM sync_state')
    expect(cursors.map((row) => row.table_name)).not.toContain('products')
  })

  it('leaves a genuine refusal where it is, and runs only once', async () => {
    await repairEncodedPayloads(db, TS)
    const [genuine] = await db.select<{ error: string }>(
      'SELECT error FROM outbox_dead WHERE seq = 7',
    )
    expect(genuine?.error).toBe('violates check constraint')

    expect(await repairEncodedPayloads(db, TS)).toBeNull()
  })
})

describe('the push-order repair', () => {
  it('sends uploads refused for a missing parent once more, and only once', async () => {
    const db = openNodeDatabase()
    await migrateLocalSchema(db)
    await db.execute('DELETE FROM local_meta WHERE key = ?', [PUSH_ORDER_REPAIR_KEY])
    await park(
      db,
      11,
      'advances',
      'a1',
      'insert',
      JSON.stringify({ id: 'a1', recovered_in_run_id: 'r1' }),
      'insert or update on table "advances" violates foreign key constraint "advances_recovered_in_run_fkey"',
    )
    await park(
      db,
      12,
      'clients',
      'c1',
      'insert',
      JSON.stringify({ id: 'c1' }),
      'violates check constraint',
    )

    expect(await requeueForeignKeyRefusals(db, TS)).toBe(1)
    expect(await db.select('SELECT seq FROM outbox')).toEqual([{ seq: 11 }])
    expect(await db.select('SELECT seq FROM outbox_dead')).toEqual([{ seq: 12 }])
    expect(await requeueForeignKeyRefusals(db, TS)).toBeNull()
  })
})
