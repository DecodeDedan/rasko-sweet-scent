import { isTauriRuntime } from '../data/bootstrap.js'

/**
 * Printing and saving documents as PDF.
 *
 * macOS's WebKit ignores `window.print()` inside an app, so there the desktop
 * shell drives AppKit itself (src-tauri/src/pdf.rs): `print_page` opens the
 * print sheet and `save_pdf` writes the PDF straight to a file the person
 * picks, the name already filled in. Everywhere else (Windows' WebView2, a
 * browser) the browser's print dialog does both, and it proposes the page
 * title as the PDF's file name, so the title is set to the document's name
 * for as long as the dialog is open.
 */

export type SavePdfOutcome =
  { status: 'saved'; path: string | null } | { status: 'cancelled' } | { status: 'dialog' }

/** Characters Windows and macOS refuse in a file name. */
const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g
const MAX_NAME_LENGTH = 150

/** Today in Africa/Nairobi (UTC+3 all year), as YYYY-MM-DD. */
export function nairobiToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** A stored UTC timestamp's Nairobi calendar day, as YYYY-MM-DD. */
export function nairobiDay(iso: string): string {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? iso.slice(0, 10) : nairobiToday(new Date(time))
}

/**
 * "Invoice INV-2026-0002 - Kabuku Packhouse - 2026-11-24.pdf".
 *
 * Parts are what the document is and who it concerns; the date goes last in
 * ISO order so a folder of saved documents sorts by date. Empty parts are
 * dropped and characters a file system refuses become hyphens.
 */
export function pdfFileName(parts: ReadonlyArray<string | null | undefined>, date: string): string {
  const stem = [...parts, date]
    .map((part) => (part ?? '').replace(UNSAFE_IN_FILE_NAME, '-').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' - ')
    .slice(0, MAX_NAME_LENGTH)
    .trim()
  return `${stem || 'Document'}.pdf`
}

/** Runs the browser's print dialog with the page titled after the document. */
function printWithTitle(title: string): void {
  const previous = document.title
  document.title = title
  try {
    window.print()
  } finally {
    document.title = previous
  }
}

function titleOf(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '')
}

/** Opens the print dialog, titled so a PDF saved from it carries `fileName`. */
export async function printPage(fileName: string): Promise<void> {
  const title = titleOf(fileName)
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    if (await invoke<boolean>('print_page', { title })) return
  }
  printWithTitle(title)
}

/**
 * Saves the page as a PDF named `fileName`. On macOS that is a save panel and
 * a file; elsewhere the print dialog opens with the name proposed, and the
 * person chooses "Save as PDF" there.
 */
export async function savePdf(fileName: string): Promise<SavePdfOutcome> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const outcome = await invoke<
      { status: 'saved'; path: string | null } | { status: 'cancelled' } | { status: 'unsupported' }
    >('save_pdf', { fileName })
    if (outcome.status !== 'unsupported') return outcome
  }
  printWithTitle(titleOf(fileName))
  return { status: 'dialog' }
}
