//! Tray / menu-bar icon with the Snap menu (plan §1.1 "Menu-bar helper").

use std::sync::Mutex;

use serde_json::json;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::capture::{self, CaptureKind};
use crate::windows::{self, dropzone, MAIN};

const TRAY_ID: &str = "skritch";
const TOOLTIP: &str = "Skritch";

/// Handle to the "Show Drop Zone" check item so its state can follow the window.
#[derive(Default)]
pub struct TrayState {
    dropzone_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);
    let crosshair = item("snap-crosshair", "Crosshair Snap", Some("Ctrl+Shift+5"))?;
    let previous = item("snap-previous", "Previous Snapshot Area", Some("Ctrl+Alt+Shift+5"))?;
    let timed = item("snap-timed", "Timed Snap", Some("Ctrl+Shift+6"))?;
    let fullscreen = item("snap-fullscreen", "Fullscreen Snap", Some("Ctrl+Shift+7"))?;
    let window = item("snap-window", "Window Snap", Some("Ctrl+Shift+8"))?;
    let blank = item("blank", "New Blank Canvas", None)?;
    let open = item("open", "Open…", None)?;
    let clipboard = item("clipboard", "From Clipboard", None)?;
    let recover = item("recover", "Recover Last Capture", None)?;
    let prefs = item("prefs", "Preferences…", None)?;
    let show = item("show", "Open Skritch", None)?;
    let quit = item("quit", "Quit", None)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let mut items: Vec<&dyn IsMenuItem<Wry>> =
        vec![&crosshair, &previous, &timed, &fullscreen, &window, &sep1, &blank, &open, &clipboard, &recover, &sep2];

    // The Windows notification area cannot accept drops, hence the Drop Zone window (plan §2.1).
    #[cfg(windows)]
    let dropzone_item = CheckMenuItem::with_id(app, "dropzone", "Show Drop Zone", true, false, None::<&str>)?;
    #[cfg(windows)]
    {
        items.push(&dropzone_item);
        *app.state::<TrayState>().dropzone_item.lock().unwrap() = Some(dropzone_item.clone());
    }
    items.extend([&prefs as &dyn IsMenuItem<Wry>, &show, &quit]);
    let menu = Menu::with_items(app, &items)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                windows::show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    // macOS: the menu-bar icon also accepts dropped files (Windows uses the Drop Zone instead).
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        tray.with_inner_tray_icon(move |inner| {
            if let Some(item) = inner.ns_status_item() {
                crate::macos::install_status_item_drop(&handle, &item);
            }
        })?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = tray;
    Ok(())
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "snap-crosshair" => capture::start_from_shortcut(app, CaptureKind::Crosshair),
        "snap-previous" => capture::start_from_shortcut(app, CaptureKind::Previous),
        "snap-timed" => capture::start_from_shortcut(app, CaptureKind::Timed),
        "snap-fullscreen" => capture::start_from_shortcut(app, CaptureKind::Fullscreen),
        "snap-window" => capture::start_from_shortcut(app, CaptureKind::Window),
        action @ ("blank" | "open" | "clipboard" | "recover" | "prefs") => {
            windows::show_main(app);
            let _ = app.emit_to(MAIN, "menu://action", json!({ "action": action }));
        }
        "dropzone" => {
            let visible = !dropzone::is_visible(app);
            if let Err(e) = dropzone::set_visible(app, visible) {
                eprintln!("[skritch] drop zone: {e}");
            }
        }
        "show" => windows::show_main(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Mirrors the Drop Zone visibility into the tray check item (no-op off Windows).
pub fn set_dropzone_checked(app: &AppHandle, checked: bool) {
    if let Some(item) = app.state::<TrayState>().dropzone_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(checked);
    }
}

/// Shows transient status (the Timed Snap countdown) in the tray tooltip, and as the menu-bar
/// title on macOS. `None` restores the default.
pub fn set_status(app: &AppHandle, status: Option<&str>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(status.unwrap_or(TOOLTIP)));
        #[cfg(target_os = "macos")]
        let _ = tray.set_title(status);
    }
}
