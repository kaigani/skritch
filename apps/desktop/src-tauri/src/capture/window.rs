//! Window Snap candidates: top-level window rects mapped into each display's shot pixels.

use serde::Serialize;
use xcap::Window;

use super::displays::MonitorBounds;
use super::region::Rect;

/// A candidate window in physical px relative to one display's shot, topmost first.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub title: String,
}

/// A window's global rect in xcap native units (same space as [`MonitorBounds`]).
#[derive(Debug, Clone, PartialEq)]
pub struct GlobalWindow {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub title: String,
}

/// Top-level windows in global coordinates, topmost first. Minimised windows and Skritch's own
/// windows are excluded. Failure to enumerate windows degrades to "no candidates" rather than
/// failing the snap.
pub fn global_candidates() -> Vec<GlobalWindow> {
    let own_pid = std::process::id();
    Window::all()
        .unwrap_or_default()
        .iter()
        .filter(|w| !w.is_minimized().unwrap_or(true) && w.pid().ok() != Some(own_pid))
        .filter_map(|w| {
            Some(GlobalWindow {
                x: w.x().ok()?,
                y: w.y().ok()?,
                w: w.width().ok()?,
                h: w.height().ok()?,
                title: w
                    .title()
                    .ok()
                    .filter(|t| !t.trim().is_empty())
                    .or_else(|| w.app_name().ok())
                    .unwrap_or_default(),
            })
        })
        .collect()
}

pub fn for_display(windows: &[GlobalWindow], bounds: &MonitorBounds, width: u32, height: u32) -> Vec<WindowRect> {
    windows.iter().filter_map(|w| to_display(w, bounds, width, height)).collect()
}

/// Match the actual selected window before considering occluding windows at its center.
/// A region uses the topmost window under its center; desktop-only regions have no window title.
pub fn title_for_rect(windows: &[WindowRect], rect: Rect, exact_window: bool) -> Option<String> {
    let chosen = if exact_window {
        windows.iter().find(|w| {
            (w.x as f64 - rect.x).abs() < 1.0
                && (w.y as f64 - rect.y).abs() < 1.0
                && (w.w as f64 - rect.w).abs() < 1.0
                && (w.h as f64 - rect.h).abs() < 1.0
        })
    } else {
        let x = rect.x + rect.w / 2.0;
        let y = rect.y + rect.h / 2.0;
        windows.iter().find(|w| {
            x >= w.x as f64 && x < (w.x as f64 + w.w as f64) && y >= w.y as f64 && y < (w.y as f64 + w.h as f64)
        })
    };
    chosen.map(|w| w.title.trim().to_owned()).filter(|t| !t.is_empty())
}

/// Maps a global window rect into a display's shot pixels, clipped to the display.
/// Returns `None` if the window does not intersect the display.
pub fn to_display(win: &GlobalWindow, display: &MonitorBounds, shot_w: u32, shot_h: u32) -> Option<WindowRect> {
    let left = win.x.max(display.x);
    let top = win.y.max(display.y);
    let right = (win.x + win.w as i32).min(display.x + display.width as i32);
    let bottom = (win.y + win.h as i32).min(display.y + display.height as i32);
    if right <= left || bottom <= top {
        return None;
    }
    // Shot px per native unit: 1 on Windows, the backing scale on macOS.
    let sx = shot_w as f64 / display.width as f64;
    let sy = shot_h as f64 / display.height as f64;
    let x = ((left - display.x) as f64 * sx).round() as i32;
    let y = ((top - display.y) as f64 * sy).round() as i32;
    Some(WindowRect {
        x,
        y,
        w: (((right - display.x) as f64 * sx).round() as i32 - x) as u32,
        h: (((bottom - display.y) as f64 * sy).round() as i32 - y) as u32,
        title: win.title.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_names_the_topmost_window_at_its_center() {
        let windows = vec![
            WindowRect { x: 20, y: 20, w: 40, h: 40, title: "Front document".into() },
            WindowRect { x: 0, y: 0, w: 200, h: 200, title: "Behind".into() },
        ];
        assert_eq!(
            title_for_rect(&windows, Rect { x: 25.0, y: 25.0, w: 10.0, h: 10.0 }, false).as_deref(),
            Some("Front document")
        );
        assert_eq!(title_for_rect(&windows, Rect { x: 300.0, y: 300.0, w: 10.0, h: 10.0 }, false), None);
        assert_eq!(
            title_for_rect(&windows, Rect { x: 0.0, y: 0.0, w: 200.0, h: 200.0 }, true).as_deref(),
            Some("Behind")
        );
    }

    const SECOND: MonitorBounds = MonitorBounds { x: 1920, y: 0, width: 2560, height: 1440 };

    fn win(x: i32, y: i32, w: u32, h: u32) -> GlobalWindow {
        GlobalWindow { x, y, w, h, title: "t".into() }
    }

    #[test]
    fn maps_relative_to_display_and_clips() {
        let r = to_display(&win(1800, 100, 400, 300), &SECOND, 2560, 1440).unwrap();
        assert_eq!((r.x, r.y, r.w, r.h), (0, 100, 280, 300));
    }

    #[test]
    fn ignores_windows_on_other_displays() {
        assert!(to_display(&win(0, 0, 800, 600), &SECOND, 2560, 1440).is_none());
    }

    #[test]
    fn scales_points_to_backing_pixels() {
        // macOS: bounds in points, shot at 2×.
        let display = MonitorBounds { x: 0, y: 0, width: 1440, height: 900 };
        let r = to_display(&win(10, 20, 100, 50), &display, 2880, 1800).unwrap();
        assert_eq!((r.x, r.y, r.w, r.h), (20, 40, 200, 100));
    }
}
