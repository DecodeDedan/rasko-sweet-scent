'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@rasko/ui'

import { printPage } from './print.js'

/**
 * A printable document (invoice, receipt, payslip, order summary, count sheet)
 * over the app. Mounted on <body>, outside `.shell`: the print stylesheet hides
 * the app frame, and a document drawn inside it printed as a blank page.
 */
export function DocumentOverlay({
  onClose,
  children,
}: {
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="doc-overlay">
      <div className="doc-toolbar rsk-no-print">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => void printPage()}>
          Print or save as PDF
        </Button>
      </div>
      {children}
    </div>,
    document.body,
  )
}
