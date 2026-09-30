//! File paths passed on the command line (file associations, "Open with", "Send to").
//!
//! First launch: the paths are held until the frontend is ready and asks for them via
//! `take_launch_paths`. Later launches are redirected by the single-instance plugin and forwarded
//! immediately as `files://dropped { source: 'args' }`.

use std::path::Path;
use std::sync::Mutex;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::windows::{self, MAIN};

/// Paths waiting for the frontend; `None` once it has taken them (later paths are emitted directly).
pub struct LaunchPaths(Mutex<Option<Vec<String>>>);

impl LaunchPaths {
    pub fn from_argv(argv: &[String]) -> Self {
        let cwd = std::env::current_dir().unwrap_or_default();
        Self(Mutex::new(Some(file_args(argv, &cwd))))
    }
}

/// Paths opened while running (macOS Apple Events: Finder "Open With", Dock drops). Before the
/// frontend has asked for its launch paths they are queued; afterwards they are forwarded at once.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn offer(app: &AppHandle, paths: Vec<String>) {
    use tauri::Manager;
    if paths.is_empty() {
        return;
    }
    if let Some(pending) = app.state::<LaunchPaths>().0.lock().unwrap().as_mut() {
        pending.extend(paths);
        return;
    }
    let _ = app.emit_to(MAIN, "files://dropped", json!({ "paths": paths, "source": "args" }));
    windows::show_main(app);
}

/// Existing files among `argv[1..]`, made absolute relative to `cwd`. Flags are ignored.
pub fn file_args(argv: &[String], cwd: &Path) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| cwd.join(arg))
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

pub fn forward_second_instance(app: &AppHandle, argv: &[String], cwd: &str) {
    let paths = file_args(argv, Path::new(cwd));
    if !paths.is_empty() {
        let _ = app.emit_to(MAIN, "files://dropped", json!({ "paths": paths, "source": "args" }));
    }
    windows::show_main(app);
}

/// Returns (and clears) the file paths the app was first launched with.
#[tauri::command]
pub fn take_launch_paths(state: State<'_, LaunchPaths>) -> Vec<String> {
    state.0.lock().unwrap().take().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::file_args;

    #[test]
    fn keeps_only_existing_files_and_resolves_relative_paths() {
        let dir = std::env::temp_dir().join(format!("skritch-launch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        let abs = dir.join("a.png").to_string_lossy().into_owned();

        let argv = ["skritch.exe", "--flag", "a.png", "missing.mp4", abs.as_str()].map(String::from);
        let paths = file_args(&argv, &dir);
        assert_eq!(paths, vec![abs.clone(), abs]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
