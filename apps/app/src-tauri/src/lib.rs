//! Rasko Sweet Scent — application shell.
//!
//! Feature modules are added one per session against `docs/prd.md`. This file
//! registers platform plugins only.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Local-first store. Every device holds a full SQLite mirror; the schema
        // is applied from TypeScript (data/sqlite/schema.ts) so the DDL and the
        // value codec stay generated from one table spec.
        .plugin(tauri_plugin_sql::Builder::default().build());

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
