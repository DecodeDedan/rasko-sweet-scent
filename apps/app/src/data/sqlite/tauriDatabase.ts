import Database from '@tauri-apps/plugin-sql'

import type { SqlDatabase, SqlExecutor } from './types.js'

/**
 * tauri-plugin-sql implementation — the real device database.
 *
 * The file lives in the app data directory, which survives an application
 * update. PRD §7: "updates never destroy unsynced local data", and the outbox
 * lives in this same file.
 *
 * ONE OPERATION AT A TIME
 * The plugin runs each call on a connection from a pool, and `BEGIN`, the
 * statements and `COMMIT` are separate calls. Without serialising them, a
 * sync cycle's transaction and a user's write interleave: the second `BEGIN`
 * fails ("cannot start a transaction within a transaction"), or a statement
 * lands on another pooled connection outside the transaction it belongs to.
 * So every call waits its turn, a transaction holds the turn from `BEGIN` to
 * `COMMIT`, and its statements go through the `tx` handle it is given. With
 * never more than one call in flight, the pool also never opens a second
 * connection, so a transaction's statements stay on its connection.
 *
 * ERRORS
 * The plugin rejects with a bare string. Every caller expects an Error with a
 * message, so strings are wrapped here, once, rather than at each screen.
 */
export const LOCAL_DB_URL = 'sqlite:rasko.db'

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

export async function openTauriDatabase(url: string = LOCAL_DB_URL): Promise<SqlDatabase> {
  const db = await Database.load(url)

  let turn: Promise<unknown> = Promise.resolve()
  function serialised<T>(operation: () => Promise<T>): Promise<T> {
    const result = turn.then(operation, operation)
    // The next caller waits for this one to settle, whether or not it failed.
    turn = result.catch(() => undefined)
    return result.catch((cause: unknown) => {
      throw asError(cause)
    })
  }

  const raw: SqlExecutor = {
    async execute(sql, params = []) {
      const result = await db.execute(sql, params as unknown[])
      return result.rowsAffected
    },
    async select<T>(sql: string, params: readonly unknown[] = []) {
      return (await db.select(sql, params as unknown[])) as T[]
    },
  }

  return {
    execute: (sql, params) => serialised(() => raw.execute(sql, params)),

    select: <T>(sql: string, params?: readonly unknown[]) =>
      serialised(() => raw.select<T>(sql, params)),

    transaction: (work) =>
      serialised(async () => {
        await raw.execute('BEGIN')
        try {
          await work(raw)
          await raw.execute('COMMIT')
        } catch (cause) {
          await raw.execute('ROLLBACK').catch(() => undefined)
          throw asError(cause)
        }
      }),

    close: () => serialised(() => db.close()).then(() => undefined),
  }
}
