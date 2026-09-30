//! Screen-recording permission status (macOS TCC). Other platforms need no permission.

/// Opens System Settings › Privacy & Security › Screen Recording (no-op elsewhere).
#[tauri::command]
pub fn open_screen_recording_settings() -> crate::error::AppResult<()> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()?;
    Ok(())
}

#[tauri::command]
pub fn capture_permission_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        crate::macos::screen_capture_permission()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "granted"
    }
}
