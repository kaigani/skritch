//! Region selection overlays (one per display) and cropping of the frozen shot.

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

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

/// Opens `overlay.html?display=N&mode=…` covering each display exactly.
pub fn open_overlays(app: &AppHandle, displays: &[MonitorBounds], mode: &str) -> AppResult<()> {
    close_overlays(app);
    for (i, bounds) in displays.iter().enumerate() {
        let url = WebviewUrl::App(format!("overlay.html?display={i}&mode={mode}").into());
        let win = WebviewWindowBuilder::new(app, format!("{LABEL_PREFIX}{i}"), url)
            .title("Skritch Capture")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .focused(true)
            .build()?;
        // No fade-in: the frozen shot must appear (and later vanish) at once.
        crate::windows::disable_transitions(&win);
        #[cfg(target_os = "macos")]
        {
            let overlay = win.clone();
            win.run_on_main_thread(move || crate::macos::raise_overlay(&overlay))?;
        }
        cover(&win, bounds)?;
        win.show()?;
        // Re-apply after showing: moving onto a display with a different DPI can rescale the
        // window (WM_DPICHANGED) between the two calls above.
        cover(&win, bounds)?;
        // Alt+F4 on an overlay means "cancel". Our own teardown uses destroy(), which skips this.
        let handle = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // Not inline: cancelling destroys this very window from inside its event handler.
                let handle = handle.clone();
                std::thread::spawn(move || super::cancel(&handle));
            }
        });
        if i == 0 {
            win.set_focus()?;
        }
    }
    Ok(())
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

pub fn close_overlays(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with(LABEL_PREFIX) {
            let _ = win.destroy();
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
