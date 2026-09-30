//! The Drop Zone: a 120×120 always-on-top frameless window that accepts file drops (plan §2.1 / §6.9).
//! It exists because the Windows notification-area icon cannot be a drop target. Drops are handled
//! by the window's own JS (`dropzone.html`); Rust only creates, shows and hides it.

use serde_json::json;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::error::AppResult;

pub const LABEL: &str = "dropzone";
const SIZE: f64 = 120.0;
/// Default distance (logical px) from the bottom-right corner of the primary work area.
const MARGIN: f64 = 32.0;

#[tauri::command]
pub fn tray_set_dropzone_visible(app: AppHandle, visible: bool) -> AppResult<()> {
    set_visible(&app, visible)
}

pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

/// Shows or hides the Drop Zone, keeps the tray check item in sync and emits
/// `dropzone://visible { visible }` so the frontend can persist the preference.
pub fn set_visible(app: &AppHandle, visible: bool) -> AppResult<()> {
    if visible {
        let win = match app.get_webview_window(LABEL) {
            Some(win) => win,
            None => create(app)?,
        };
        win.show()?;
    } else if let Some(win) = app.get_webview_window(LABEL) {
        // Hidden rather than closed so its position survives for the rest of the session.
        win.hide()?;
    }
    crate::tray::set_dropzone_checked(app, visible);
    let _ = app.emit("dropzone://visible", json!({ "visible": visible }));
    Ok(())
}

fn create(app: &AppHandle) -> AppResult<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("dropzone.html".into()))
        .title("Skritch Drop Zone")
        .inner_size(SIZE, SIZE)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    // It is hidden for captures; the hide must be instant.
    super::disable_transitions(&win);

    if let Ok(Some(monitor)) = win.primary_monitor() {
        let area = monitor.work_area();
        let offset = ((SIZE + MARGIN) * monitor.scale_factor()).round() as i32;
        let x = area.position.x + area.size.width as i32 - offset;
        let y = area.position.y + area.size.height as i32 - offset;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    // Alt+F4 / close from the frontend behaves like unticking "Show Drop Zone".
    let handle = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = set_visible(&handle, false);
        }
    });
    Ok(win)
}
