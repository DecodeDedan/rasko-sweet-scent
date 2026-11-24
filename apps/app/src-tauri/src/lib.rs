//! Rasko Sweet Scent — application shell.
//!
//! Feature modules are added one per session against `docs/prd.md`. This file
//! registers platform plugins, and the printing commands the webview cannot do itself.

#[cfg(target_os = "macos")]
mod pdf;

/// Opens the print dialog for the page, where WebKit ignores `window.print()`
/// inside an app (macOS). Answers false elsewhere, and the page then calls
/// `window.print()`, which WebView2 honours. See apps/app/src/shell/print.ts.
/// `title` names the job, which macOS proposes as the PDF file name.
#[tauri::command]
fn print_page(webview: tauri::Webview, title: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        webview
            .with_webview(move |platform| pdf::print(&platform, &title))
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, title);
        Ok(false)
    }
}

/// What became of a request to save the page as a PDF.
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum SavePdf {
    Saved { path: Option<String> },
    Cancelled,
    /// No native save here; the page falls back to the print dialog.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
}

/// Saves the page as a PDF under `file_name`, asking only where (macOS).
#[tauri::command]
async fn save_pdf(webview: tauri::Webview, file_name: String) -> Result<SavePdf, String> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        webview
            .with_webview(move |platform| {
                // The page is waiting on the receiver; if it has gone there is
                // nobody left to tell.
                let _ = sender.send(pdf::save(&platform, &file_name));
            })
            .map_err(|e| e.to_string())?;
        let outcome = tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())??;
        Ok(match outcome {
            Some(path) => SavePdf::Saved { path: Some(path) },
            None => SavePdf::Cancelled,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, file_name);
        Ok(SavePdf::Unsupported)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Local-first store. Every device holds a full SQLite mirror; the schema
        // is applied from TypeScript (data/sqlite/schema.ts) so the DDL and the
        // value codec stay generated from one table spec.
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![print_page, save_pdf]);

    // Desktop auto-update (PRD §7), signed against the minisign public key in
    // tauri.conf.json. Not built for mobile: an APK cannot replace itself, so
    // Android checks the same manifest in-app and sends the user to download.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running Rasko Sweet Scent");
}
