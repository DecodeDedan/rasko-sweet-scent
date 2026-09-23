import { openNodeDatabase } from '../sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../sqlite/schema.js'
import type { SqlDatabase } from '../sqlite/types.js'
import { Repository } from '../repositories/repository.js'
import { runSync } from '../sync/engine.js'
import type { SyncOutcome } from '../sync/engine.js'
import { pendingCount } from '../sync/outbox.js'
import type { SyncRemote } from '../sync/remote.js'
import type { MockServer } from './mockServer.js'

/** One installed device: its own SQLite file, its own outbox, its own cursors. */
export interface Device {
  db: SqlDatabase
  remote: SyncRemote
  userId: string
  repo(table: string): Repository
  sync(): Promise<SyncOutcome>
  pending(): Promise<number>
  close(): Promise<void>
}

export async function createDevice(
  server: MockServer,
  userId: string,
  options: { path?: string; clock?: () => string } = {},
): Promise<Device> {
  const db = openNodeDatabase(options.path ?? ':memory:')
  await migrateLocalSchema(db)

  // Device clocks differ in reality, so the tests use one that is deliberately
  // wrong. Nothing in sync ordering may depend on it.
  const now = options.clock ?? (() => new Date().toISOString())
  const remote = server.remoteFor(userId)

  return {
    db,
    remote,
    userId,
    repo: (table) => new Repository(db, table, { userId, now }),
    sync: () => runSync(db, remote),
    pending: () => pendingCount(db),
    close: () => db.close(),
  }
}

/** Reopens the same database file — what an application relaunch does (T5). */
export async function restartDevice(
  server: MockServer,
  userId: string,
  path: string,
): Promise<Device> {
  return createDevice(server, userId, { path })
}

let counter = 0
/** Deterministic ids, so a failure names the same row every run. */
export function id(prefix: string): string {
  counter += 1
  return `${prefix}-${String(counter).padStart(8, '0')}-0000-4000-8000-000000000000`.slice(0, 36)
}
