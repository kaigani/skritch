//! Global capture hotkeys (plan §1.3). ⌃⇧ on macOS too: ⌘⇧5 is reserved by the system.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::capture::{self, CaptureKind};

pub fn register(app: &AppHandle) {
    let bindings = [
        (Code::Digit5, CaptureKind::Crosshair),
        (Code::Digit6, CaptureKind::Timed),
        (Code::Digit7, CaptureKind::Fullscreen),
        (Code::Digit8, CaptureKind::Window),
    ];
    let previous = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT), Code::Digit5);
    let _ = app.global_shortcut().on_shortcut(previous, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            capture::start_from_shortcut(app, CaptureKind::Previous);
        }
    });
    for (code, kind) in bindings {
        let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), code);
        let result = app.global_shortcut().on_shortcut(shortcut, move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                capture::start_from_shortcut(app, kind);
            }
        });
        // Another app may own the combination; the tray menu still works, so just log it.
        if let Err(e) = result {
            eprintln!("[skritch] could not register hotkey {shortcut}: {e}");
        }
    }
}
