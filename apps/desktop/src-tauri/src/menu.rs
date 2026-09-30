//! Native application menus. Document actions are routed to the active document webview.
use serde_json::json;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(not(target_os = "macos"))]
use tauri::Manager;
use tauri::{AppHandle, Emitter};

fn item(app: &AppHandle, id: &str, text: &str, key: Option<&str>) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, format!("app-{id}"), text, true, key)
}
fn section(app: &AppHandle, name: &str, entries: &[(&str, &str, Option<&str>)]) -> tauri::Result<Submenu<tauri::Wry>> {
    let menu = Submenu::new(app, name, true)?;
    for (id, label, key) in entries {
        if id.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        } else {
            menu.append(&item(app, id, label, *key)?)?;
        }
    }
    Ok(menu)
}
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let app_menu = Submenu::new(app, "Skritch", true)?;
    app_menu.append(&PredefinedMenuItem::about(app, Some("About Skritch"), None)?)?;
    app_menu.append(&item(app, "prefs", "Preferences…", Some("CmdOrCtrl+,"))?)?;
    #[cfg(target_os = "macos")]
    {
        app_menu.append(&PredefinedMenuItem::separator(app)?)?;
        app_menu.append(&PredefinedMenuItem::services(app, None)?)?;
        app_menu.append(&PredefinedMenuItem::separator(app)?)?;
        app_menu.append(&PredefinedMenuItem::hide(app, None)?)?;
        app_menu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
        app_menu.append(&PredefinedMenuItem::show_all(app, None)?)?;
    }
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&PredefinedMenuItem::quit(app, Some("Quit Skritch"))?)?;
    let file = section(
        app,
        "File",
        &[
            ("new-window", "New Skritch Window", Some("CmdOrCtrl+N")),
            ("blank", "New Blank Canvas", Some("CmdOrCtrl+Shift+N")),
            ("open", "Open…", Some("CmdOrCtrl+O")),
            ("export", "Export…", Some("CmdOrCtrl+E")),
            ("", "", None),
            ("close", "Close", Some("CmdOrCtrl+W")),
            ("save", "Save", Some("CmdOrCtrl+S")),
            ("save-as", "Save As…", Some("CmdOrCtrl+Shift+S")),
            ("save-project", "Save Project…", None),
            ("", "", None),
            ("page-setup", "Page Setup…", Some("CmdOrCtrl+Shift+P")),
            ("print", "Print…", Some("CmdOrCtrl+P")),
        ],
    )?;
    let edit = section(
        app,
        "Edit",
        &[
            ("undo", "Undo", Some("CmdOrCtrl+Z")),
            ("redo", "Redo", Some("CmdOrCtrl+Shift+Z")),
            ("", "", None),
            ("cut", "Cut", Some("CmdOrCtrl+X")),
            ("copy", "Copy", Some("CmdOrCtrl+C")),
            ("copy-image", "Copy Image", Some("CmdOrCtrl+Shift+C")),
            ("clipboard", "Paste", Some("CmdOrCtrl+V")),
            ("delete", "Delete", None),
            ("select-all", "Select All", Some("CmdOrCtrl+A")),
            ("", "", None),
            ("clear-annotations", "Clear All Annotations", None),
        ],
    )?;
    let view = section(
        app,
        "View",
        &[
            ("zoom-in", "Zoom In", Some("CmdOrCtrl+=")),
            ("zoom-out", "Zoom Out", Some("CmdOrCtrl+-")),
            ("actual-size", "Actual Size", Some("CmdOrCtrl+1")),
            ("fit", "Fit in Window", Some("CmdOrCtrl+0")),
        ],
    )?;
    view.append(&PredefinedMenuItem::fullscreen(app, None)?)?;
    let image = Submenu::new(app, "Image", true)?;
    image.append(&section(app, "Flip", &[("flip-h", "Horizontal", None), ("flip-v", "Vertical", None)])?)?;
    image.append(&item(app, "rotate-cw", "Rotate Clockwise", Some("CmdOrCtrl+R"))?)?;
    image.append(&item(app, "rotate-ccw", "Rotate Counterclockwise", Some("CmdOrCtrl+Shift+R"))?)?;
    image.append(&PredefinedMenuItem::separator(app)?)?;
    image.append(&item(app, "order-front", "Move to Top", Some("CmdOrCtrl+Shift+]"))?)?;
    image.append(&item(app, "order-forward", "Move Forward", Some("CmdOrCtrl+]"))?)?;
    image.append(&item(app, "order-backward", "Move Backward", Some("CmdOrCtrl+["))?)?;
    image.append(&item(app, "order-back", "Move to Back", Some("CmdOrCtrl+Shift+["))?)?;
    let tools = section(
        app,
        "Tools",
        &[
            ("tool-select", "Select", None),
            ("tool-arrow", "Arrow", None),
            ("tool-text", "Text", None),
            ("tool-shape", "Shape", None),
            ("tool-pen", "Pen", None),
            ("tool-highlight", "Highlighter", None),
            ("tool-stamp", "Stamp", None),
            ("tool-pixelate", "Pixelate", None),
            ("tool-crop", "Crop", None),
        ],
    )?;
    let capture = section(
        app,
        "Capture",
        &[
            ("capture-crosshair", "Crosshair Snapshot", Some("Ctrl+Shift+5")),
            ("capture-previous", "Previous Snapshot Area", Some("Ctrl+Alt+Shift+5")),
            ("capture-timed", "Timed Crosshair Snapshot", Some("Ctrl+Shift+6")),
            ("capture-fullscreen", "Fullscreen Snapshot", Some("Ctrl+Shift+7")),
            ("capture-window", "Window Snapshot…", Some("Ctrl+Shift+8")),
            ("capture-menu", "Menu Snapshot…", None),
            ("", "", None),
            ("open", "Open an Image or Video…", None),
            ("recover", "Recover Last Capture", None),
        ],
    )?;
    let share = section(
        app,
        "Share",
        &[("copy-image", "Copy Image", None), ("copy-file", "Copy as File", None), ("export", "Export…", None)],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &item(app, "show", "Show Skritch", None)?,
        ],
    )?;
    let help = section(app, "Help", &[("help", "Skritch Help", None)])?;
    let menu =
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &image, &tools, &capture, &share, &window, &help])?;
    app.set_menu(menu)?;
    #[cfg(target_os = "macos")]
    {
        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
    }
    app.on_menu_event(|app, event| {
        let Some(action) = event.id().as_ref().strip_prefix("app-") else { return };
        if action == "new-window" {
            if let Err(e) = crate::windows::new_document_window(app) {
                eprintln!("[skritch] new window: {e}");
            }
        } else if action == "show" {
            crate::windows::show_main(app);
        } else {
            let target = crate::windows::active_document(app);
            let _ = app.emit_to(&target, "menu://action", json!({ "action": action }));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn print_document(window: tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    return window.print();
    #[cfg(not(target_os = "macos"))]
    window.eval("window.print()")
}

#[tauri::command]
pub fn page_setup(app: AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(|| {
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            objc2_app_kit::NSPageLayout::pageLayout(mtm).runModal();
        }
    })?;
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window(&crate::windows::active_document(&app)) {
        window.eval("window.print()")?;
    }
    Ok(())
}

#[tauri::command]
pub fn menu_set_enabled(
    app: AppHandle,
    window: tauri::WebviewWindow,
    enabled: std::collections::HashMap<String, bool>,
) -> tauri::Result<()> {
    if crate::windows::active_document(&app) != window.label() {
        return Ok(());
    }
    fn update(
        items: Vec<tauri::menu::MenuItemKind<tauri::Wry>>,
        enabled: &std::collections::HashMap<String, bool>,
    ) -> tauri::Result<()> {
        for item in items {
            match item {
                tauri::menu::MenuItemKind::MenuItem(item) => {
                    if let Some(value) = item.id().as_ref().strip_prefix("app-").and_then(|id| enabled.get(id)) {
                        item.set_enabled(*value)?;
                    }
                }
                tauri::menu::MenuItemKind::Submenu(menu) => update(menu.items()?, enabled)?,
                _ => {}
            }
        }
        Ok(())
    }
    if let Some(menu) = app.menu() {
        update(menu.items()?, &enabled)?;
    }
    Ok(())
}
