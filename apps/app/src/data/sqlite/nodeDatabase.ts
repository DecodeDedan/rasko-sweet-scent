import { createRequire } from 'node:module'

import type { SqlDatabase } from './types.js'

/*
 * Loaded through createRequire rather than a static import.
 *
 * Vite's list of Node builtins predates node:sqlite: it strips the `node:`
 * prefix, tries to resolve a package called "sqlite", and fails with
 * "Failed to load url sqlite". A require() call is not statically analysable,
 * so the bundler leaves it alone and Node resolves it at run time.
 *
 * This file is imported only by tests; the device uses tauriDatabase.ts.
 */
interface SqliteStatement {
  run(...params: never[]): { changes: number | bigint }
  all(...params: never[]): unknown[]
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

/**
 * node:sqlite implementation, used only by the integration tests.
 *
 * Deliberately a real SQLite engine rather than an in-memory fake: T6 asserts
 * that a replayed sync produces no duplicates, and that claim only means
 * something if a real PRIMARY KEY is doing the work. A fake would happily agree
 * with whatever the code did.
 *
 * Pass a file path to model a restart (T5): closing and reopening the same file
 * is what an application relaunch actually does.
 */
export function openNodeDatabase(path = ':memory:'): SqlDatabase {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')

  let depth = 0

  return {
    async execute(sql, params = []) {
      if (params.length === 0) {
        db.exec(sql)
        return 0
      }
      const result = db.prepare(sql).run(...(params as never[]))
      return Number(result.changes)
    },

    async select<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[]
    },

    async transaction(work) {
      // Nested calls join the outer transaction rather than starting a second
      // one, which SQLite does not allow.
      if (depth > 0) {
        depth += 1
        try {
          await work()
        } finally {
          depth -= 1
        }
        return
      }

      depth = 1
      db.exec('BEGIN')
      try {
        await work()
        db.exec('COMMIT')
      } catch (cause) {
        db.exec('ROLLBACK')
        throw cause
      } finally {
        depth = 0
      }
    },

    async close() {
      db.close()
    },
  }
}
