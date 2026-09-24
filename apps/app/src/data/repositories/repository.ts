import { decodeRow, encodeRow, encodeValue } from '../sqlite/codec.js'
import { tableSpec } from '../sqlite/tables.js'
import type { TableSpec } from '../sqlite/tables.js'
import type { SqlDatabase } from '../sqlite/types.js'
import { enqueue } from '../sync/outbox.js'

/**
 * Local-only data access.
 *
 * The rule feature modules depend on: **a repository never touches the
 * network**. Reads come from SQLite; writes go to SQLite and the outbox, and
 * the sync engine carries them upward on its own schedule. That is what makes
 * "the UI never blocks on the network" (NFR-S1) structurally true rather than a
 * thing each screen has to remember.
 */

export interface WriteContext {
  /** profiles.id of the signed-in user, stamped onto created_by / updated_by. */
  userId: string | null
  now?: () => string
  /** Called after each write so the scheduler can debounce a sync (NFR-S3). */
  onLocalWrite?: () => void
}

export interface ListOptions {
  where?: string
  params?: readonly unknown[]
  orderBy?: string
  limit?: number
  /** Include soft-deleted rows. Off by default — deletes are invisible. */
  includeDeleted?: boolean
}

export class Repository<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly spec: TableSpec

  constructor(
    private readonly db: SqlDatabase,
    tableName: string,
    private readonly context: WriteContext,
  ) {
    this.spec = tableSpec(tableName)
  }

  private now(): string {
    return (this.context.now ?? (() => new Date().toISOString()))()
  }

  private hasColumn(name: string): boolean {
    return this.spec.columns.some((column) => column.name === name)
  }

  async list(options: ListOptions = {}): Promise<T[]> {
    const clauses: string[] = []
    if (!options.includeDeleted && this.hasColumn('deleted_at')) {
      clauses.push('deleted_at IS NULL')
    }
    if (options.where) clauses.push(`(${options.where})`)

    const sql = [
      `SELECT * FROM ${this.spec.name}`,
      clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      options.orderBy ? `ORDER BY ${options.orderBy}` : '',
      options.limit ? `LIMIT ${Math.floor(options.limit)}` : '',
    ]
      .filter(Boolean)
      .join(' ')

    const rows = await this.db.select<Record<string, unknown>>(sql, options.params ?? [])
    return rows.map((row) => decodeRow(this.spec, row) as T)
  }

  async findById(id: string): Promise<T | null> {
    const rows = await this.list({ where: 'id = ?', params: [id], limit: 1, includeDeleted: true })
    return rows[0] ?? null
  }

  async count(where?: string, params: readonly unknown[] = []): Promise<number> {
    const clauses: string[] = []
    if (this.hasColumn('deleted_at')) clauses.push('deleted_at IS NULL')
    if (where) clauses.push(`(${where})`)

    const rows = await this.db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${this.spec.name}${
        clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
      }`,
      params,
    )
    return Number(rows[0]?.n ?? 0)
  }

  /**
   * Writes a new row locally and queues it.
   *
   * The id is client-generated (architecture.md §6.4) — that is what makes an
   * offline create possible and a retried push idempotent.
   */
  async insert(values: Partial<T> & { id: string }): Promise<T> {
    const timestamp = this.now()
    const row: Record<string, unknown> = { ...values }

    if (this.hasColumn('created_at')) row['created_at'] ??= timestamp
    if (this.hasColumn('updated_at')) row['updated_at'] ??= timestamp
    if (this.hasColumn('created_by')) row['created_by'] ??= this.context.userId
    if (this.hasColumn('updated_by')) row['updated_by'] ??= this.context.userId

    await this.writeLocal(row, 'insert')
    return decodeRow(this.spec, row) as T
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const current = await this.findById(id)
    if (!current) throw new Error(`${this.spec.name} ${id} not found locally.`)

    const row: Record<string, unknown> = { ...current, ...patch, id }
    if (this.hasColumn('updated_at')) row['updated_at'] = this.now()
    if (this.hasColumn('updated_by')) row['updated_by'] = this.context.userId

    await this.writeLocal(row, 'update')
    return decodeRow(this.spec, row) as T
  }

  /**
   * Soft delete (NFR-S5). Never a DELETE: a hard delete cannot be communicated
   * to a device that is offline, so it would silently diverge.
   */
  async softDelete(id: string): Promise<void> {
    if (!this.hasColumn('deleted_at')) {
      throw new Error(`${this.spec.name} is append-only and cannot be deleted.`)
    }
    await this.update(id, { deleted_at: this.now() } as unknown as Partial<T>)
  }

  private async writeLocal(row: Record<string, unknown>, op: 'insert' | 'update'): Promise<void> {
    const { columns, values } = encodeRow(this.spec, row)
    const placeholders = columns.map(() => '?').join(', ')
    const assignments = columns
      .filter((column) => column !== 'id')
      .map((column) => `${column} = excluded.${column}`)
      .join(', ')

    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO ${this.spec.name} (${columns.join(', ')}, sync_status)
         VALUES (${placeholders}, 'pending')
         ON CONFLICT (id) DO UPDATE SET ${assignments}, sync_status = 'pending'`,
        values,
      )
      // The payload is the server-shaped row: what the push will send verbatim.
      await enqueue(tx, this.spec.name, String(row['id']), op, row, this.now())
    })

    this.context.onLocalWrite?.()
  }

  /** Escape hatch for aggregates a repository cannot express. Reads only. */
  async raw<R = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> {
    if (!/^\s*select\b/i.test(sql)) {
      throw new Error('Repository.raw is read-only; use insert/update/softDelete to write.')
    }
    return this.db.select<R>(sql, params)
  }

  encode(column: string, value: unknown): unknown {
    const spec = this.spec.columns.find((candidate) => candidate.name === column)
    if (!spec) throw new Error(`${this.spec.name} has no column ${column}.`)
    return encodeValue(spec.kind, value)
  }
}

export function createRepository<T extends Record<string, unknown>>(
  db: SqlDatabase,
  tableName: string,
  context: WriteContext,
): Repository<T> {
  return new Repository<T>(db, tableName, context)
}
