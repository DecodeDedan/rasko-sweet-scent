import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const isTauriRuntime = vi.fn(() => false)
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../../data/bootstrap.js', () => ({ isTauriRuntime }))

const { DocumentOverlay } = await import('../DocumentOverlay.js')
const { printPage } = await import('../print.js')

describe('DocumentOverlay', () => {
  it('renders outside the app frame, which the print stylesheet hides', () => {
    render(
      <div className="shell">
        <DocumentOverlay onClose={() => {}}>
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
    render(<DocumentOverlay onClose={onClose}>doc</DocumentOverlay>)

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('printPage', () => {
  const print = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('print', print)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    isTauriRuntime.mockReturnValue(false)
  })

  it('uses the browser print outside the desktop app', async () => {
    await printPage()
    expect(print).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('lets the desktop shell print where the webview ignores window.print (macOS)', async () => {
    isTauriRuntime.mockReturnValue(true)
    invoke.mockResolvedValue(true)

    await printPage()
    expect(invoke).toHaveBeenCalledWith('print_page')
    expect(print).not.toHaveBeenCalled()
  })

  it('falls back to the browser print where the shell does not print (Windows)', async () => {
    isTauriRuntime.mockReturnValue(true)
    invoke.mockResolvedValue(false)

    await printPage()
    expect(print).toHaveBeenCalledTimes(1)
  })
})
