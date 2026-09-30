//! Timed Snap countdown: 5…1 in the tray tooltip / menu-bar title plus `capture://countdown`.

use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter};

pub const SECONDS: u32 = 5;

/// Blocks for `SECONDS`, announcing each remaining second.
pub fn countdown(app: &AppHandle) {
    for remaining in (1..=SECONDS).rev() {
        crate::tray::set_status(app, Some(&format!("Skritch — {remaining}…")));
        let _ = app.emit("capture://countdown", json!({ "remaining": remaining }));
        std::thread::sleep(Duration::from_secs(1));
    }
    crate::tray::set_status(app, None);
}
