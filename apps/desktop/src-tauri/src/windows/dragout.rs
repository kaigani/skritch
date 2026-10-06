//! "Drag Me" (plan §1.1): a native file drag out of a document window. The window gets out of the
//! way as soon as the drag begins, so the drop lands on whatever is underneath (and never back on
//! Skritch itself). A successful drop returns the window behind other apps; a cancelled drag brings
//! it back to the front.

use std::path::PathBuf;

use tauri::{AppHandle, WebviewWindow};

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn drag_out(app: AppHandle, window: WebviewWindow, path: PathBuf, icon: PathBuf) -> AppResult<()> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let restore = window.clone();
        let on_end = move |result: drag::DragResult, _: drag::CursorPosition| {
            restore_after(&restore, matches!(result, drag::DragResult::Dropped))
        };
        // Windows' DoDragDrop blocks until the drop, so hide first; AppKit needs the window
        // onscreen to begin the session but then tracks the drag on its own.
        #[cfg(not(target_os = "macos"))]
        hide(&window);
        let started = drag::start_drag(
            &window,
            drag::DragItem::Files(vec![path]),
            drag::Image::File(icon),
            on_end,
            drag::Options { skip_animatation_on_cancel_or_failure: true, mode: drag::DragMode::Copy },
        );
        match &started {
            #[cfg(target_os = "macos")]
            Ok(()) => hide(&window),
            #[cfg(not(target_os = "macos"))]
            Ok(()) => {}
            Err(_) => restore_after(&window, false),
        }
        let _ = tx.send(started.map_err(|e| AppError::new("drag", e.to_string())));
    })?;
    rx.recv().map_err(|_| AppError::new("drag", "the drag did not start"))?
}

/// Called on the main thread.
fn hide(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    let _ = crate::macos::hide_for_capture(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window.hide();
}

/// Called on the main thread.
fn restore_after(window: &WebviewWindow, dropped: bool) {
    if !dropped {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    #[cfg(target_os = "macos")]
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: Tauri owns this live NSWindow and we are on AppKit's main thread.
        let ns_window = unsafe { &*(ptr as *const objc2_app_kit::NSWindow) };
        ns_window.orderBack(None);
    }
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
        };
        // SAFETY: a live window handle owned by Tauri.
        unsafe {
            ShowWindow(hwnd.0, SW_SHOWNOACTIVATE);
            SetWindowPos(hwnd.0, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = window.show();
}
