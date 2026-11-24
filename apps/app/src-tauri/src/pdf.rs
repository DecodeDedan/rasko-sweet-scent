//! Printing and PDF output for the macOS webview.
//!
//! WebKit ignores `window.print()` inside an app, so the shell drives
//! AppKit's print machinery itself. wry's `Webview::print()` leaves two gaps
//! this module closes:
//!
//! - The print view WebKit hands back starts with a zero frame. Printed as
//!   is, the preview can come up empty and "Save as PDF" has nothing to write.
//!   The view is sized to the webview before the operation runs.
//! - The job has no title, and the title is what macOS proposes as the PDF's
//!   file name. Every job is titled with the name the document chose.
//!
//! `save` skips the print sheet altogether: it asks where to save, with the
//! name already filled in, and writes the PDF there.

use std::ptr::null_mut;

use objc2::{rc::Retained, runtime::ProtocolObject, MainThreadMarker};
use objc2_app_kit::{
    NSModalResponseOK, NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob,
    NSSavePanel, NSWindow,
};
use objc2_foundation::{NSCopying, NSString};
use objc2_web_kit::WKWebView;
use tauri::webview::PlatformWebview;

/// The platform objects behind a Tauri webview.
///
/// # Safety
/// Must run on the main thread, inside `Webview::with_webview`, which is
/// where Tauri guarantees both pointers are live for the closure's duration.
unsafe fn parts(platform: &PlatformWebview) -> (&WKWebView, &NSWindow) {
    // SAFETY: on macOS `inner()` is the WKWebView and `ns_window()` the
    // NSWindow that hosts it; both outlive the with_webview closure.
    unsafe {
        (
            &*(platform.inner() as *const WKWebView),
            &*(platform.ns_window() as *const NSWindow),
        )
    }
}

fn operation(webview: &WKWebView, info: &NSPrintInfo, title: &str) -> Retained<NSPrintOperation> {
    // SAFETY: printOperationWithPrintInfo: exists from macOS 11, the app's
    // minimum, and is called on the main thread with a valid print info.
    let operation = unsafe { webview.printOperationWithPrintInfo(info) };
    if let Some(view) = operation.view() {
        view.setFrame(webview.bounds());
    }
    operation.setJobTitle(Some(&NSString::from_str(title)));
    operation.setCanSpawnSeparateThread(true);
    operation
}

fn run(operation: &NSPrintOperation, window: &NSWindow) {
    // SAFETY: no delegate or selector, so a null context is valid; the
    // window is the webview's own and is live on the main thread.
    unsafe {
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            window,
            None,
            None,
            null_mut(),
        );
    }
}

/// Opens the print sheet for the page, titled `title`.
pub fn print(platform: &PlatformWebview, title: &str) {
    // SAFETY: called from with_webview on the main thread.
    let (webview, window) = unsafe { parts(platform) };
    let info = NSPrintInfo::sharedPrintInfo().copy();
    run(&operation(webview, &info, title), window);
}

/// Asks where to save, proposing `file_name`, and writes the page there as a
/// PDF. Answers the saved path, or `None` when the person cancelled.
pub fn save(platform: &PlatformWebview, file_name: &str) -> Result<Option<String>, String> {
    let mtm = MainThreadMarker::new().ok_or("Saving a PDF must run on the main thread.")?;
    // SAFETY: called from with_webview on the main thread.
    let (webview, window) = unsafe { parts(platform) };

    let panel = NSSavePanel::savePanel(mtm);
    panel.setNameFieldStringValue(&NSString::from_str(file_name));
    panel.setCanCreateDirectories(true);
    if panel.runModal() != NSModalResponseOK {
        return Ok(None);
    }
    let url = panel.URL().ok_or("No file was chosen.")?;

    // A copy, so the shared print settings the print sheet uses are untouched.
    let info = NSPrintInfo::sharedPrintInfo().copy();
    // SAFETY: NSPrintSaveJob and NSPrintJobSavingURL are AppKit constants;
    // the saving URL key takes an NSURL, which is what is stored.
    unsafe {
        info.setJobDisposition(NSPrintSaveJob);
        info.dictionary()
            .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
    }

    let title = file_name.strip_suffix(".pdf").unwrap_or(file_name);
    let job = operation(webview, &info, title);
    job.setShowsPrintPanel(false);
    job.setShowsProgressPanel(false);
    run(&job, window);

    Ok(url.path().map(|path| path.to_string()))
}
