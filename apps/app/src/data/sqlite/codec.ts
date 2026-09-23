import { tableSpec } from './tables.js'
import type { ColumnKind, TableSpec } from './tables.js'
import type { SqlValue } from './types.js'

/**
 * Converts between the server's JSON shape and SQLite storage (architecture.md §9.1).
 *
 * The two conversions that matter:
 *
 *   - `qty` (numeric(12,3)) is stored as an INTEGER of thousandths. SQLite's REAL
 *     is binary floating point and would drift under repeated summation, which is
 *     exactly what the stock aggregate does.
 *   - `money` is already integer cents everywhere (PRD §7) and never becomes a
 *     float in transit.
 */

const QTY_SCALE = 1000

export function encodeValue(kind: ColumnKind, value: unknown): SqlValue {
  if (value === null || value === undefined) return null

  switch (kind) {
    case 'bool':
      return value ? 1 : 0
    case 'qty':
      return Math.round(Number(value) * QTY_SCALE)
    case 'money':
    case 'int':
      return typeof value === 'bigint' ? value : Math.round(Number(value))
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value)
    default:
      return String(value)
  }
}

export function decodeValue(kind: ColumnKind, value: SqlValue): unknown {
  if (value === null || value === undefined) return null

  switch (kind) {
    case 'bool':
      return Number(value) !== 0
    case 'qty':
      return Number(value) / QTY_SCALE
    case 'money':
    case 'int':
      return Number(value)
    case 'json':
      try {
        return JSON.parse(String(value))
      } catch {
        return null
      }
    default:
      return String(value)
  }
}

/** Server row -> values ready to bind into a local INSERT. */
export function encodeRow(
  spec: TableSpec,
  row: Record<string, unknown>,
): { columns: string[]; values: SqlValue[] } {
  const columns: string[] = []
  const values: SqlValue[] = []

  for (const column of spec.columns) {
    columns.push(column.name)
    values.push(encodeValue(column.kind, row[column.name]))
  }
  return { columns, values }
}

/** Local row -> the JSON shape the server expects. */
export function decodeRow(spec: TableSpec, row: Record<string, unknown>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {}
  for (const column of spec.columns) {
    decoded[column.name] = decodeValue(column.kind, (row[column.name] ?? null) as SqlValue)
  }
  return decoded
}

export function decodeRows(
  tableName: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const spec = tableSpec(tableName)
  return rows.map((row) => decodeRow(spec, row))
}
