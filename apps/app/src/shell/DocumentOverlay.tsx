'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@rasko/ui'

import { printPage, savePdf } from './print.js'

/**
 * A printable document (invoice, receipt, payslip, order summary, count sheet)
 * over the app. Mounted on <body>, outside `.shell`: the print stylesheet hides
 * the app frame, and a document drawn inside it printed as a blank page.
 *
 * `fileName` is what the saved PDF is called: the document, who it concerns
 * and its date (`pdfFileName` in print.ts).
 */
export function DocumentOverlay({
  onClose,
  fileName,
  children,
}: {
  onClose: () => void
  fileName: string
  children: ReactNode
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    setStatus(null)
    setIsSaving(true)
    try {
      const outcome = await savePdf(fileName)
      if (outcome.status === 'saved') setStatus(`Saved ${outcome.path ?? fileName}`)
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'The PDF could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="doc-overlay">
      <div className="doc-toolbar rsk-no-print">
        {status ? (
          <p className="doc-toolbar__status" role="status">
            {status}
          </p>
        ) : null}
        <Button onClick={onClose}>Close</Button>
        <Button onClick={() => void printPage(fileName)}>Print</Button>
        <Button variant="primary" isLoading={isSaving} onClick={() => void handleSave()}>
          Save PDF
        </Button>
      </div>
      {children}
    </div>,
    document.body,
  )
}
