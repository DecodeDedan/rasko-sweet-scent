'use client'

import { useEffect } from 'react'
import { Button, formatDate, formatQuantity } from '@rasko/ui'

import type { ProductStock } from './types.js'

/**
 * FR-6.8: a printable stock-count sheet.
 *
 * The system's figure is printed beside a blank box for the counted figure, so
 * the person counting writes what they find rather than reading what the system
 * expects — the whole point of a count is to catch the difference.
 */
export function StockCountSheet({
  products,
  companyName,
  onClose,
}: {
  products: readonly ProductStock[]
  companyName: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="doc-overlay">
      <div className="doc-toolbar rsk-no-print">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="doc-page">
        <header className="doc-header">
          <div>
            <p className="doc-company">{companyName}</p>
            <p className="doc-meta">Nakuru, Kenya</p>
          </div>
          <div className="doc-title-block">
            <h1 className="doc-title">Stock count sheet</h1>
            <p className="doc-meta">{formatDate(today)}</p>
          </div>
        </header>

        <div className="doc-rule" />

        <section className="doc-event">
          <p className="doc-label">How to use this</p>
          <p className="doc-meta">
            Count each product and write the figure in the Counted column. Enter any difference in
            the system as an adjustment, with the reason, so the ledger and the shelf agree.
          </p>
        </section>

        <table className="doc-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Unit</th>
              <th className="rsk-numeric">System</th>
              <th className="rsk-numeric">Counted</th>
              <th className="rsk-numeric">Difference</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td>{product.unit}</td>
                <td className="rsk-numeric">{formatQuantity(product.currentStock)}</td>
                <td className="count-box" />
                <td className="count-box" />
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="doc-footer">
          <div className="count-signoff">
            <div>
              <p className="doc-label">Counted by</p>
              <div className="count-rule" />
            </div>
            <div>
              <p className="doc-label">Checked by</p>
              <div className="count-rule" />
            </div>
            <div>
              <p className="doc-label">Date</p>
              <div className="count-rule" />
            </div>
          </div>
        </footer>
      </article>
    </div>
  )
}
