//! Window helpers shared by the tray, capture and single-instance code, plus the Windows Drop Zone.

pub mod dropzone;

use tauri::{AppHandle, Manager, WebviewWindow};

/// Label of the main document window (declared in tauri.conf.json).
pub const MAIN: &str = "main";

/// Makes show/hide instant. Windows 11 fades windows out when hidden; without this, a capture
/// taken right after hiding catches Skritch half-transparent in the shot.
#[cfg_attr(not(windows), allow(unused_variables))]
pub fn disable_transitions(win: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = win.hwnd() {
        use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
        // Win32 BOOL TRUE.
        let disabled: i32 = 1;
        // SAFETY: a live window handle and a correctly sized BOOL, as the API requires.
        unsafe {
            DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_TRANSITIONS_FORCEDISABLED as u32,
                (&disabled as *const i32).cast(),
                std::mem::size_of::<i32>() as u32,
            );
        }
    }
}

/// Shows, un-minimises and focuses the main window.
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[derive(Default)]
pub struct DocumentWindows(pub std::sync::Mutex<String>);
pub fn is_document(label: &str) -> bool {
    label == MAIN || label.starts_with("doc-")
}
pub fn active_document(app: &AppHandle) -> String {
    if let Some((label, _)) =
        app.webview_windows().into_iter().find(|(label, win)| is_document(label) && win.is_focused().unwrap_or(false))
    {
        return label;
    }
    let last = app.state::<DocumentWindows>().0.lock().unwrap().clone();
    if !last.is_empty() && app.get_webview_window(&last).is_some() {
        last
    } else {
        MAIN.into()
    }
}
pub fn new_document_window(app: &AppHandle) -> tauri::Result<()> {
    let label = format!("doc-{}", crate::capture::displays::stamp());
    let builder = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("Skritch")
        .inner_size(1100.0, 760.0)
        .min_inner_size(640.0, 480.0);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0));
    let window = builder.build()?;
    disable_transitions(&window);
    window.set_focus()?;
    Ok(())
}
