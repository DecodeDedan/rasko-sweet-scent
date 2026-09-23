import Database from '@tauri-apps/plugin-sql'

import type { SqlDatabase } from './types.js'

/**
 * tauri-plugin-sql implementation — the real device database.
 *
 * The file lives in the app data directory, which survives an application
 * update. PRD §7: "updates never destroy unsynced local data", and the outbox
 * lives in this same file.
 */
export const LOCAL_DB_URL = 'sqlite:rasko.db'

export async function openTauriDatabase(url: string = LOCAL_DB_URL): Promise<SqlDatabase> {
  const db = await Database.load(url)

  return {
    async execute(sql, params = []) {
      const result = await db.execute(sql, params as unknown[])
      return result.rowsAffected
    },

    async select<T>(sql: string, params: readonly unknown[] = []) {
      return (await db.select(sql, params as unknown[])) as T[]
    },

    async transaction(work) {
      await db.execute('BEGIN')
      try {
        await work()
        await db.execute('COMMIT')
      } catch (cause) {
        await db.execute('ROLLBACK')
        throw cause
      }
    },

    async close() {
      await db.close()
    },
  }
}
