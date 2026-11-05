import { isTauriRuntime } from '../data/bootstrap.js'

/**
 * Opens the print dialog, from which both platforms save a PDF.
 *
 * macOS's WebKit ignores `window.print()` inside an app, so there the desktop
 * shell prints the webview itself (`print_page` in src-tauri/src/lib.rs) and
 * answers true. Everywhere else it answers false and the browser print, which
 * Windows' WebView2 honours, does the job.
 */
export async function printPage(): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    if (await invoke<boolean>('print_page')) return
  }
  window.print()
}
