import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { TABLES } from '../sqlite/tables.js'

/**
 * Pushes go table by table in TABLES order. A row whose foreign key points at
 * a row in a later table reaches the server before its parent, is refused as
 * a broken reference, and is parked as permanently failed. That is how a
 * recovered advance (advances.recovered_in_run_id -> payroll_runs) was lost.
 * This reads every foreign key from the migrations and checks the order.
 */
// Tests run from apps/app (jsdom gives modules http URLs, not file paths).
const MIGRATIONS = resolve(process.cwd(), '../../supabase/migrations')

function foreignKeys(): Array<{ table: string; parent: string }> {
  const keys: Array<{ table: string; parent: string }> = []
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    for (const match of sql.matchAll(/create table public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      for (const ref of match[2]!.matchAll(/references public\.(\w+)/g)) {
        keys.push({ table: match[1]!, parent: ref[1]! })
      }
    }
    for (const match of sql.matchAll(/alter table public\.(\w+)([\s\S]*?);/g)) {
      for (const ref of match[2]!.matchAll(/references public\.(\w+)/g)) {
        keys.push({ table: match[1]!, parent: ref[1]! })
      }
    }
  }
  return keys
}

describe('push order', () => {
  it('reads foreign keys from the migrations', () => {
    expect(foreignKeys()).toContainEqual({ table: 'advances', parent: 'payroll_runs' })
  })

  it('pushes every parent table before the tables that reference it', () => {
    const position = new Map(TABLES.map((spec, index) => [spec.name, index]))
    const outOfOrder = foreignKeys()
      .filter(({ table, parent }) => table !== parent)
      .filter(({ table, parent }) => position.has(table) && position.has(parent))
      .filter(({ table, parent }) => position.get(parent)! > position.get(table)!)
      .map(({ table, parent }) => `${table} -> ${parent}`)
    expect([...new Set(outOfOrder)]).toEqual([])
  })
})
