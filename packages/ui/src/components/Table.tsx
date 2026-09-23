import type { ReactNode } from 'react'

import { cx } from '../utils/cx.js'

export interface TableColumn<Row> {
  key: string
  header: string
  /** Right-aligns and applies tabular numerals. Use for money and quantity columns. */
  isNumeric?: boolean
  width?: string
  render: (row: Row) => ReactNode
}

export interface TableProps<Row> {
  columns: ReadonlyArray<TableColumn<Row>>
  rows: readonly Row[]
  getRowKey: (row: Row) => string
  /** Rendered in place of the table body when there are no rows. */
  empty?: ReactNode
  caption?: string
  onRowSelect?: (row: Row) => void
  className?: string
}

/**
 * Desktop list presentation (PRD §7). Dense, typography-led, no zebra colour
 * beyond the subtle surface token.
 */
export function Table<Row>({
  columns,
  rows,
  getRowKey,
  empty,
  caption,
  onRowSelect,
  className,
}: TableProps<Row>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>
  }

  return (
    <div className={cx('rsk-table-wrap', className)}>
      <table className="rsk-table">
        {caption ? <caption className="rsk-table__caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(column.isNumeric && 'rsk-numeric')}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              className={cx(onRowSelect && 'rsk-table__row--selectable')}
              onClick={onRowSelect ? () => onRowSelect(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={cx(column.isNumeric && 'rsk-numeric')}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
