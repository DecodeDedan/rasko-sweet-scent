/**
 * The database surface the sync layer and repositories use.
 *
 * Two implementations exist: `tauriDatabase` (tauri-plugin-sql, on device) and
 * `nodeDatabase` (node:sqlite, tests only). Everything above this interface is
 * identical in both, so the tests exercise the real SQL rather than a fake.
 */
export interface SqlExecutor {
  /** DDL or a write. Returns the number of rows affected. */
  execute(sql: string, params?: readonly unknown[]): Promise<number>
  select<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
}

export interface SqlDatabase extends SqlExecutor {
  /**
   * Runs `work` as one transaction. Statements inside must go through the
   * `tx` handle it is given, not the database itself: on the device every
   * operation is serialised (tauriDatabase.ts), and a statement sent to the
   * database from inside the transaction would wait for the transaction that
   * is waiting for it.
   */
  transaction(work: (tx: SqlExecutor) => Promise<void>): Promise<void>
  close(): Promise<void>
}

export type SqlValue = string | number | bigint | null
