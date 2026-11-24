import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const isTauriRuntime = vi.fn(() => false)
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../../data/bootstrap.js', () => ({ isTauriRuntime }))

const { DocumentOverlay } = await import('../DocumentOverlay.js')
const { pdfFileName, printPage, savePdf } = await import('../print.js')

describe('DocumentOverlay', () => {
  it('renders outside the app frame, which the print stylesheet hides', () => {
    render(
      <div className="shell">
        <DocumentOverlay onClose={() => {}} fileName="Invoice INV-2026-0001 - 2026-11-24.pdf">
          <article>Invoice body</article>
        </DocumentOverlay>
      </div>,
    )

    const body = screen.getByText('Invoice body')
    expect(body.closest('.shell')).toBeNull()
    expect(body.closest('.doc-overlay')?.parentElement).toBe(document.body)
  })

  it('closes on Escape and on the Close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <DocumentOverlay onClose={onClose} fileName="doc.pdf">
        doc
      </DocumentOverlay>,
    )

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('pdfFileName', () => {
  it('names the document, who it concerns and the date', () => {
    expect(pdfFileName(['Invoice INV-2026-0002', 'Kabuku Packhouse'], '2026-11-24')).toBe(
      'Invoice INV-2026-0002 - Kabuku Packhouse - 2026-11-24.pdf',
    )
  })

  it('drops empty parts and replaces characters a file system refuses', () => {
    expect(pdfFileName(['Statement of account', 'A/B: "Flowers"', null, ' '], '2026-11-24')).toBe(
      'Statement of account - A-B- -Flowers- - 2026-11-24.pdf',
    )
  })
})

describe('printPage and savePdf', () => {
  const print = vi.fn()
  let titleWhilePrinting = ''
  beforeEach(() => {
    print.mockImplementation(() => {
      titleWhilePrinting = document.title
    })
    vi.stubGlobal('print', print)
    document.title = 'RSS Management System'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    isTauriRuntime.mockReturnValue(false)
  })

  it('titles the browser print after the file, then restores the window title', async () => {
    await printPage('Invoice INV-2026-0002 - 2026-11-24.pdf')
    expect(print).toHaveBeenCalledTimes(1)
    expect(titleWhilePrinting).toBe('Invoice INV-2026-0002 - 2026-11-24')
    expect(document.title).toBe('RSS Management System')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('lets the desktop shell print, titled, where the webview ignores window.print (macOS)', async () => {
    isTauriRuntime.mockReturnValue(true)
    invoke.mockResolvedValue(true)

    await printPage('Receipt - 2026-11-24.pdf')
    expect(invoke).toHaveBeenCalledWith('print_page', { title: 'Receipt - 2026-11-24' })
    expect(print).not.toHaveBeenCalled()
  })

  it('falls back to the browser print where the shell does not print (Windows)', async () => {
    isTauriRuntime.mockReturnValue(true)
    invoke.mockResolvedValue(false)

    await printPage('Receipt - 2026-11-24.pdf')
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('saves straight to a file where the shell can (macOS)', async () => {
    isTauriRuntime.mockReturnValue(true)
    invoke.mockResolvedValue({ status: 'saved', path: '/Users/x/Invoice.pdf' })

    expect(await savePdf('Invoice.pdf')).toEqual({ status: 'saved', path: '/Users/x/Invoice.pdf' })
    expect(invoke).toHaveBeenCalledWith('save_pdf', { fileName: 'Invoice.pdf' })
    expect(print).not.toHaveBeenCalled()
  })

  it('opens the named print dialog where it cannot (Windows, browser)', async () => {
    isTauriRuntime.mockReturnValue(true)
    invoke.mockResolvedValue({ status: 'unsupported' })

    expect(await savePdf('Payslip - Mary - 2026-11.pdf')).toEqual({ status: 'dialog' })
    expect(titleWhilePrinting).toBe('Payslip - Mary - 2026-11')
  })

  it('reports where the overlay saved the file', async () => {
    isTauriRuntime.mockReturnValue(true)
    invoke.mockResolvedValue({ status: 'saved', path: '/Users/x/Statement.pdf' })
    const user = userEvent.setup()
    render(
      <DocumentOverlay onClose={() => {}} fileName="Statement.pdf">
        doc
      </DocumentOverlay>,
    )

    await user.click(screen.getByRole('button', { name: 'Save PDF' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved /Users/x/Statement.pdf')
  })
})
