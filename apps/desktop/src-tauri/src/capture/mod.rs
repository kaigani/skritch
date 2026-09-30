//! Capture pipeline (plan §4.5).
//!
//! `start` hides Skritch's windows and grabs the displays on a worker thread. Fullscreen finishes
//! immediately; the interactive kinds open one overlay per display and park the shots in a
//! [`Session`] until an overlay calls `capture_overlay_finish`. Every path ends in exactly one of
//! `capture://result`, `capture://cancelled` or `capture://error`, which also clears `busy`.

pub mod displays;
pub mod permissions;
pub mod region;
pub mod timed;
pub mod window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::windows;
use displays::DisplayShot;
use region::Rect;
use window::WindowRect;

/// How long "Recover Last Capture" keeps a result.
const RECOVER_FOR: Duration = Duration::from_secs(10 * 60);
/// Non-macOS compositor grace period after disabling Windows hide transitions.
#[cfg(not(target_os = "macos"))]
const HIDE_SETTLE: Duration = Duration::from_millis(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureKind {
    Crosshair,
    Timed,
    Fullscreen,
    Window,
    Previous,
}

impl CaptureKind {
    fn overlay_mode(self) -> &'static str {
        match self {
            CaptureKind::Crosshair | CaptureKind::Fullscreen | CaptureKind::Previous => "crosshair",
            CaptureKind::Timed => "timed",
            CaptureKind::Window => "window",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub png_path: String,
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub window_title: Option<String>,
    pub captured_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    shot_path: String,
    width: u32,
    height: u32,
    scale: f32,
    windows: Vec<WindowRect>,
    mode: &'static str,
}

struct Session {
    kind: CaptureKind,
    shots: Vec<DisplayShot>,
    windows: Vec<Vec<WindowRect>>,
    captured_at: u64,
}

#[derive(Clone)]
struct PreviousArea {
    bounds: displays::MonitorBounds,
    rect: Rect,
    width: u32,
    height: u32,
}

#[derive(Default)]
pub struct CaptureState {
    busy: AtomicBool,
    target: Mutex<String>,
    previous: Mutex<Option<PreviousArea>>,
    session: Mutex<Option<Session>>,
    /// Labels of our windows hidden for the capture, restored when it ends.
    hidden: Mutex<Vec<String>>,
    last: Mutex<Option<(CaptureResult, Instant)>>,
}

#[tauri::command]
pub fn capture_start(app: AppHandle, kind: CaptureKind) -> AppResult<()> {
    start(&app, kind)
}

/// Hotkey / tray entry point: a capture already in progress simply wins.
pub fn start_from_shortcut(app: &AppHandle, kind: CaptureKind) {
    if let Err(e) = start(app, kind) {
        eprintln!("[skritch] capture not started: {e}");
    }
}

pub fn start(app: &AppHandle, kind: CaptureKind) -> AppResult<()> {
    if app.state::<CaptureState>().busy.swap(true, Ordering::SeqCst) {
        return Err(AppError::new("busy", "a capture is already in progress"));
    }
    *app.state::<CaptureState>().target.lock().unwrap() = windows::active_document(app);
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = begin(&app, kind) {
            fail(&app, e);
        }
    });
    Ok(())
}

fn begin(app: &AppHandle, kind: CaptureKind) -> AppResult<()> {
    // Without Screen Recording access macOS returns only the wallpaper and our own windows. The
    // frontend shows an explainer with an "Open System Settings" button for this error code.
    #[cfg(target_os = "macos")]
    if !crate::macos::ensure_screen_capture_access() {
        return Err(AppError::new("permission", "Skritch needs Screen Recording permission to capture the screen"));
    }
    displays::purge_old(RECOVER_FOR + Duration::from_secs(60));
    hide_own_windows(app)?;

    if kind == CaptureKind::Previous {
        let previous = app
            .state::<CaptureState>()
            .previous
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| AppError::capture("Take a snapshot first to reuse its area"))?;
        let captured_at = displays::stamp() as u64;
        let (bounds, scale, image) = displays::grab_at(
            previous.bounds.x + previous.bounds.width as i32 / 2,
            previous.bounds.y + previous.bounds.height as i32 / 2,
        )?;
        if bounds != previous.bounds {
            return Err(AppError::capture("The previous capture display has moved or disconnected"));
        }
        let rect = Rect {
            x: previous.rect.x * image.width() as f64 / previous.width as f64,
            y: previous.rect.y * image.height() as f64 / previous.height as f64,
            w: previous.rect.w * image.width() as f64 / previous.width as f64,
            h: previous.rect.h * image.height() as f64 / previous.height as f64,
        };
        let windows = window::for_display(&window::global_candidates(), &bounds, image.width(), image.height());
        let title = window::title_for_rect(&windows, rect, false);
        deliver(app, save_result(&region::crop(&image, rect)?, scale, title, captured_at)?);
        return Ok(());
    }
    if kind == CaptureKind::Fullscreen {
        let (x, y) = cursor_for_xcap(app)?;
        let captured_at = displays::stamp() as u64;
        let windows = window::global_candidates();
        let (bounds, scale, image) = displays::grab_at(x, y)?;
        *app.state::<CaptureState>().previous.lock().unwrap() = Some(PreviousArea {
            bounds,
            rect: Rect { x: 0.0, y: 0.0, w: image.width() as f64, h: image.height() as f64 },
            width: image.width(),
            height: image.height(),
        });
        let candidates = window::for_display(&windows, &bounds, image.width(), image.height());
        let title = candidates.first().map(|w| w.title.clone()).filter(|t| !t.trim().is_empty());
        deliver(app, save_result(&image, scale, title, captured_at)?);
        return Ok(());
    }

    let captured_at = displays::stamp() as u64;
    let shots = displays::capture_all()?;
    let windows = window::candidates(&shots);
    let bounds: Vec<_> = shots.iter().map(|s| s.bounds).collect();
    // Stored before the overlays exist: they ask for it as soon as their page loads.
    *app.state::<CaptureState>().session.lock().unwrap() = Some(Session { kind, shots, windows, captured_at });
    region::open_overlays(app, &bounds, kind.overlay_mode())
}

/// Cursor position in the coordinate space `xcap::Monitor::from_point` expects: physical pixels on
/// Windows, global points on macOS.
fn cursor_for_xcap(app: &AppHandle) -> AppResult<(i32, i32)> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        let (x, y) =
            crate::macos::cursor_location().ok_or_else(|| AppError::capture("could not read the mouse location"))?;
        Ok((x.round() as i32, y.round() as i32))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let cursor = app.cursor_position()?;
        Ok((cursor.x.round() as i32, cursor.y.round() as i32))
    }
}

#[tauri::command]
pub fn capture_overlay_info(state: State<'_, CaptureState>, display: u32) -> AppResult<OverlayInfo> {
    let session = state.session.lock().unwrap();
    let session = session.as_ref().ok_or_else(no_session)?;
    let shot = session.shots.get(display as usize).ok_or_else(|| bad_display(display))?;
    Ok(OverlayInfo {
        shot_path: shot.path.to_string_lossy().into_owned(),
        width: shot.image.width(),
        height: shot.image.height(),
        scale: shot.scale,
        windows: session.windows[display as usize].clone(),
        mode: session.kind.overlay_mode(),
    })
}

/// `rect: None` cancels. `timed` closes the overlays, counts down, then re-grabs that display.
#[tauri::command]
pub fn capture_overlay_finish(app: AppHandle, display: u32, rect: Option<Rect>, timed: bool) -> AppResult<()> {
    let Some(rect) = rect else {
        cancel(&app);
        return Ok(());
    };
    let session = app.state::<CaptureState>().session.lock().unwrap().take().ok_or_else(no_session)?;
    let Some(shot) = session.shots.into_iter().nth(display as usize) else {
        fail(&app, bad_display(display));
        return Ok(());
    };
    *app.state::<CaptureState>().previous.lock().unwrap() =
        Some(PreviousArea { bounds: shot.bounds, rect, width: shot.image.width(), height: shot.image.height() });
    let window_title = session
        .windows
        .get(display as usize)
        .and_then(|windows| window::title_for_rect(windows, rect, session.kind == CaptureKind::Window));
    region::close_overlays(&app);
    // Cropping and encoding take tens of ms on a 4K shot; keep them off the main thread.
    std::thread::spawn(move || {
        let mut captured_at = session.captured_at;
        let mut window_title = window_title;
        let cropped = if timed {
            timed::countdown(&app);
            captured_at = displays::stamp() as u64;
            let windows = window::for_display(
                &window::global_candidates(),
                &shot.bounds,
                shot.image.width(),
                shot.image.height(),
            );
            window_title = window::title_for_rect(&windows, rect, false);
            displays::recapture(shot.monitor_id).and_then(|image| region::crop(&image, rect))
        } else {
            region::crop(&shot.image, rect)
        };
        match cropped.and_then(|image| save_result(&image, shot.scale, window_title, captured_at)) {
            Ok(result) => deliver(&app, result),
            Err(e) => fail(&app, e),
        }
    });
    Ok(())
}

/// The most recent capture if it is less than 10 minutes old ("Recover Last Capture").
#[tauri::command]
pub fn capture_last(state: State<'_, CaptureState>) -> Option<CaptureResult> {
    let last = state.last.lock().unwrap();
    last.as_ref()
        .filter(|(result, at)| at.elapsed() < RECOVER_FOR && std::path::Path::new(&result.png_path).is_file())
        .map(|(result, _)| result.clone())
}

fn save_result(
    image: &image::RgbaImage,
    scale: f32,
    window_title: Option<String>,
    captured_at: u64,
) -> AppResult<CaptureResult> {
    let path = displays::capture_dir()?.join(format!("capture-{}.png", displays::stamp()));
    displays::write_png(image, &path)?;
    Ok(CaptureResult {
        png_path: path.to_string_lossy().into_owned(),
        width: image.width(),
        height: image.height(),
        scale,
        window_title,
        captured_at,
    })
}

#[cfg(not(target_os = "macos"))]
fn hide_own_windows(app: &AppHandle) -> AppResult<()> {
    let mut hidden = Vec::new();
    for (label, win) in app.webview_windows() {
        let on_screen = win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false);
        if on_screen && win.hide().is_ok() {
            hidden.push(label);
        }
    }
    if !hidden.is_empty() {
        std::thread::sleep(HIDE_SETTLE);
    }
    *app.state::<CaptureState>().hidden.lock().unwrap() = hidden;
    Ok(())
}

#[cfg(target_os = "macos")]
fn hide_own_windows(app: &AppHandle) -> AppResult<()> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> AppResult<Vec<u32>> {
            let state = handle.state::<CaptureState>();
            let mut ids = Vec::new();
            for (label, window) in handle.webview_windows() {
                if let Some(id) = crate::macos::hide_for_capture(&window)? {
                    // Record each successful hide immediately so an error restores partial work too.
                    state.hidden.lock().unwrap().push(label);
                    ids.push(id);
                }
            }
            Ok(ids)
        })();
        let _ = tx.send(result);
    })?;
    // This function only runs on the capture worker, never on AppKit's main thread.
    let ids = rx.recv().map_err(|_| AppError::capture("Could not hide Skritch before capture"))??;
    if ids.is_empty() {
        return Ok(());
    }
    wait_for_hidden_windows(|| {
        // On macOS xcap enumerates CGWindowList OptionOnScreenOnly, so this checks the compositor
        // rather than merely trusting the application's local isVisible flag.
        Ok(xcap::Window::all()?.iter().any(|w| w.id().is_ok_and(|id| ids.contains(&id))))
    })
}

/// Require a stable offscreen interval before reading display pixels. A timeout fails the capture
/// (restoring the editor) instead of returning a screenshot with our UI still in it.
#[cfg(any(target_os = "macos", test))]
fn wait_for_hidden_windows(mut visible: impl FnMut() -> AppResult<bool>) -> AppResult<()> {
    wait_for_hidden_windows_with(
        &mut visible,
        Duration::from_secs(2),
        Duration::from_millis(120),
        Duration::from_millis(16),
    )
}

#[cfg(any(target_os = "macos", test))]
fn wait_for_hidden_windows_with(
    visible: &mut impl FnMut() -> AppResult<bool>,
    timeout: Duration,
    settle: Duration,
    poll: Duration,
) -> AppResult<()> {
    let started = Instant::now();
    let mut clear_since = None;
    loop {
        if visible()? {
            clear_since = None;
        } else if clear_since.get_or_insert_with(Instant::now).elapsed() >= settle {
            return Ok(());
        }
        if started.elapsed() >= timeout {
            return Err(AppError::capture("Skritch is still visible. Please try the capture again."));
        }
        std::thread::sleep(poll);
    }
}

/// Tears the session down and restores hidden windows; `show_main` also brings the main window
/// to the front even if it was hidden before the capture.
fn end_session(app: &AppHandle, show_main: bool) {
    let state = app.state::<CaptureState>();
    region::close_overlays(app);
    state.session.lock().unwrap().take();
    for label in std::mem::take(&mut *state.hidden.lock().unwrap()) {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.show();
        }
    }
    if show_main {
        let target = state.target.lock().unwrap().clone();
        if let Some(window) = app.get_webview_window(&target) {
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            windows::show_main(app);
        }
    }
    state.busy.store(false, Ordering::SeqCst);
}

fn deliver(app: &AppHandle, result: CaptureResult) {
    *app.state::<CaptureState>().last.lock().unwrap() = Some((result.clone(), Instant::now()));
    end_session(app, true);
    let _ = app.emit_to(app.state::<CaptureState>().target.lock().unwrap().as_str(), "capture://result", result);
}

fn fail(app: &AppHandle, error: AppError) {
    eprintln!("[skritch] capture failed: {error}");
    end_session(app, true);
    let _ = app.emit_to(app.state::<CaptureState>().target.lock().unwrap().as_str(), "capture://error", error);
}

pub(crate) fn cancel(app: &AppHandle) {
    end_session(app, false);
    let _ = app.emit("capture://cancelled", json!({}));
}

fn no_session() -> AppError {
    AppError::new("no_session", "no capture is in progress")
}

fn bad_display(display: u32) -> AppError {
    AppError::invalid(format!("no display {display} in this capture"))
}

#[cfg(test)]
mod hide_tests {
    use super::*;

    #[test]
    fn waits_until_windows_remain_offscreen() {
        let mut observations = 0;
        wait_for_hidden_windows_with(
            &mut || {
                observations += 1;
                // A brief disappearance is not enough: the window reappears on the third poll.
                Ok(observations == 1 || observations == 3)
            },
            Duration::from_secs(1),
            Duration::from_millis(3),
            Duration::from_millis(1),
        )
        .unwrap();
        assert!(observations >= 5);
    }

    #[test]
    fn refuses_to_capture_a_window_that_does_not_hide() {
        let error =
            wait_for_hidden_windows_with(&mut || Ok(true), Duration::ZERO, Duration::ZERO, Duration::ZERO).unwrap_err();
        assert_eq!(error.code, "capture");
    }

    #[test]
    fn propagates_window_query_failure() {
        let error = wait_for_hidden_windows(|| Err(AppError::capture("WindowServer unavailable"))).unwrap_err();
        assert_eq!(error.message, "WindowServer unavailable");
    }
}
