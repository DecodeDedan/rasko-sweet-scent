/**
 * The database surface the sync layer and repositories use.
 *
 * Two implementations exist: `tauriDatabase` (tauri-plugin-sql, on device) and
 * `nodeDatabase` (node:sqlite, tests only). Everything above this interface is
 * identical in both, so the tests exercise the real SQL rather than a fake.
 */
export interface SqlDatabase {
  /** DDL or a write. Returns the number of rows affected. */
  execute(sql: string, params?: readonly unknown[]): Promise<number>
  select<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  /** Runs a batch of statements as one transaction. */
  transaction(work: () => Promise<void>): Promise<void>
  close(): Promise<void>
}

export type SqlValue = string | number | bigint | null
