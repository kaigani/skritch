//! Region selection overlays (one per display) and cropping of the frozen shot.

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::displays::MonitorBounds;
use crate::error::{AppError, AppResult};

const LABEL_PREFIX: &str = "overlay-";

/// A rectangle in physical pixels of one display's shot.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Serialises overlay creation: the start-up pre-warm and a capture may both want a missing window.
static CREATE: Mutex<()> = Mutex::new(());

fn label(display: usize) -> String {
    format!("{LABEL_PREFIX}{display}")
}

/// Starts creating one hidden overlay window per display in the background, shortly after launch,
/// so the first capture does not pay for webview start-up and the frontend bundle load.
pub fn prewarm(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Let the main window finish its own start-up first.
        std::thread::sleep(Duration::from_millis(1500));
        let _ = ensure_overlays(&app);
    });
}

/// Makes sure there is an overlay window for every display currently attached.
pub fn ensure_overlays(app: &AppHandle) -> AppResult<()> {
    ensure_overlays_for(app, xcap::Monitor::all()?.len())
}

/// Makes sure overlay windows `0..count` exist (hidden). They are reused by every later capture:
/// each page stays loaded and is re-armed over an event instead of being rebuilt.
pub fn ensure_overlays_for(app: &AppHandle, count: usize) -> AppResult<()> {
    let _guard = CREATE.lock().unwrap();
    for i in 0..count {
        if app.get_webview_window(&label(i)).is_some() {
            continue;
        }
        create(app, i)?;
        super::perf::mark(&format!("overlay window {i} created"));
    }
    Ok(())
}

fn create(app: &AppHandle, display: usize) -> AppResult<()> {
    let url = WebviewUrl::App(format!("overlay.html?display={display}").into());
    let win = WebviewWindowBuilder::new(app, label(display), url)
        .title("Skritch Capture")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .build()?;
    // No fade-in: the frozen shot must appear (and later vanish) at once.
    crate::windows::disable_transitions(&win);
    #[cfg(target_os = "macos")]
    {
        let overlay = win.clone();
        win.run_on_main_thread(move || crate::macos::raise_overlay(&overlay))?;
    }
    // Alt+F4 on an overlay means "cancel". Overlays are only ever hidden, never closed, so this
    // is the only way a close request reaches them.
    let handle = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let handle = handle.clone();
            std::thread::spawn(move || super::cancel(&handle));
        }
    });
    Ok(())
}

/// Places every overlay over its display (still hidden) and tells its page to load capture
/// `session`. Each page reports back through `capture_overlay_ready`, which calls [`show`]. If a
/// page never does (a crashed webview), a watchdog shows it anyway so the user is not stuck.
pub fn arm(app: &AppHandle, displays: &[MonitorBounds], session: u64) -> AppResult<()> {
    for (i, bounds) in displays.iter().enumerate() {
        let win = app.get_webview_window(&label(i)).ok_or_else(|| AppError::capture("capture overlay is missing"))?;
        cover(&win, bounds)?;
        win.emit("capture://overlay-arm", session)?;
    }
    super::perf::mark("overlays armed");
    let app = app.clone();
    let bounds = displays.to_vec();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(2500));
        if super::session_id(&app) == Some(session) {
            for (i, b) in bounds.iter().enumerate() {
                if app.get_webview_window(&label(i)).is_some_and(|w| !w.is_visible().unwrap_or(false)) {
                    eprintln!("[skritch] overlay {i} did not report ready; showing it anyway");
                    show(&app, i, b);
                }
            }
        }
    });
    Ok(())
}

/// Reveals an armed overlay. The first display's overlay takes keyboard focus (Esc to cancel).
pub fn show(app: &AppHandle, display: usize, bounds: &MonitorBounds) {
    let Some(win) = app.get_webview_window(&label(display)) else { return };
    let _ = cover(&win, bounds);
    let _ = win.show();
    // Re-apply after showing: moving onto a display with a different DPI can rescale the
    // window (WM_DPICHANGED) between the two calls above.
    let _ = cover(&win, bounds);
    if display == 0 {
        let _ = win.set_focus();
    }
}

/// Places a window exactly over a display. xcap reports physical px on Windows and points on macOS,
/// which is what Tauri's physical / logical setters expect respectively.
fn cover(win: &WebviewWindow, b: &MonitorBounds) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        win.set_position(tauri::LogicalPosition::new(b.x as f64, b.y as f64))?;
        win.set_size(tauri::LogicalSize::new(b.width as f64, b.height as f64))
    }
    #[cfg(not(target_os = "macos"))]
    {
        win.set_position(tauri::PhysicalPosition::new(b.x, b.y))?;
        win.set_size(tauri::PhysicalSize::new(b.width, b.height))
    }
}

/// Hides every overlay and tells its page to drop the frozen shot. The windows stay alive for
/// the next capture.
pub fn release_overlays(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with(LABEL_PREFIX) {
            let _ = win.hide();
            let _ = win.emit("capture://overlay-reset", ());
        }
    }
}

/// Crops `rect` (rounded, clamped to the image) out of a shot.
pub fn crop(image: &RgbaImage, rect: Rect) -> AppResult<RgbaImage> {
    let (iw, ih) = (image.width() as f64, image.height() as f64);
    let x0 = rect.x.min(rect.x + rect.w).round().clamp(0.0, iw);
    let y0 = rect.y.min(rect.y + rect.h).round().clamp(0.0, ih);
    let x1 = rect.x.max(rect.x + rect.w).round().clamp(0.0, iw);
    let y1 = rect.y.max(rect.y + rect.h).round().clamp(0.0, ih);
    let (w, h) = ((x1 - x0) as u32, (y1 - y0) as u32);
    if w == 0 || h == 0 {
        return Err(AppError::invalid("selection is empty or outside the display"));
    }
    Ok(image::imageops::crop_imm(image, x0 as u32, y0 as u32, w, h).to_image())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(w: u32, h: u32) -> RgbaImage {
        RgbaImage::from_fn(w, h, |x, y| image::Rgba([x as u8, y as u8, 0, 255]))
    }

    #[test]
    fn crops_rounded_rect() {
        let out = crop(&gradient(100, 50), Rect { x: 10.4, y: 5.6, w: 20.0, h: 10.0 }).unwrap();
        assert_eq!((out.width(), out.height()), (20, 10));
        assert_eq!(out.get_pixel(0, 0).0, [10, 6, 0, 255]);
    }

    #[test]
    fn normalises_negative_size_and_clamps_to_image() {
        let out = crop(&gradient(100, 50), Rect { x: 110.0, y: 60.0, w: -30.0, h: -20.0 }).unwrap();
        assert_eq!((out.width(), out.height()), (20, 10));
        assert_eq!(out.get_pixel(0, 0).0, [80, 40, 0, 255]);
    }

    #[test]
    fn rejects_empty_selection() {
        assert!(crop(&gradient(10, 10), Rect { x: 20.0, y: 0.0, w: 5.0, h: 5.0 }).is_err());
        assert!(crop(&gradient(10, 10), Rect { x: 2.0, y: 2.0, w: 0.2, h: 5.0 }).is_err());
    }
}
