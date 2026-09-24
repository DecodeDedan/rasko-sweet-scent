import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

import type { SqlDatabase } from './types.js'

/**
 * DEVELOPMENT ONLY — an in-memory SQLite for running the app in a browser.
 *
 * The real device database is tauri-plugin-sql (`tauriDatabase.ts`). Outside the
 * Tauri shell there is no plugin, so `vite dev` had no local storage at all and
 * every data screen rendered its "unavailable" state. That made the browser
 * useless for building features, and left the whole repository layer only
 * reachable by rebuilding the Rust binary.
 *
 * This adapter closes that gap with SQLite compiled to WebAssembly. It is
 * imported dynamically and only when `import.meta.env.DEV` is set, so it is
 * never part of a production bundle.
 *
 * It does not persist: reload and the mirror is empty, then sync refills it from
 * the server. That is fine for development and deliberately unlike a real
 * device, where the file survives a restart (T5).
 */
export async function openBrowserDatabase(): Promise<SqlDatabase> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const db = new SQL.Database()
  let depth = 0

  const adapter: SqlDatabase = {
    async execute(sql, params = []) {
      if (params.length === 0) {
        db.run(sql)
        return 0
      }
      db.run(sql, params as never[])
      return db.getRowsModified()
    },

    async select<T>(sql: string, params: readonly unknown[] = []) {
      const statement = db.prepare(sql)
      try {
        if (params.length > 0) statement.bind(params as never[])
        const rows: T[] = []
        while (statement.step()) rows.push(statement.getAsObject() as T)
        return rows
      } finally {
        statement.free()
      }
    },

    async transaction(work) {
      if (depth > 0) {
        depth += 1
        try {
          await work(adapter)
        } finally {
          depth -= 1
        }
        return
      }
      depth = 1
      db.run('BEGIN')
      try {
        await work(adapter)
        db.run('COMMIT')
      } catch (cause) {
        db.run('ROLLBACK')
        throw cause
      } finally {
        depth = 0
      }
    },

    async close() {
      db.close()
    },
  }
  return adapter
}
