//! Grabbing whole displays with xcap, and writing capture results as PNGs.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, RgbaImage};
use xcap::Monitor;

use crate::error::{AppError, AppResult};

/// A display's geometry in xcap's native units: physical px on Windows, points on macOS.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// One frozen display: its pixels, kept in memory for the overlay and for cropping.
pub struct DisplayShot {
    pub monitor_id: u32,
    pub bounds: MonitorBounds,
    pub scale: f32,
    pub image: RgbaImage,
}

/// Where shots and capture results live. Separate from `temp_write`'s directory, which is purged
/// after 60 s, because a capture must survive for "Recover Last Capture".
pub fn capture_dir() -> AppResult<PathBuf> {
    let dir = std::env::temp_dir().join("skritch-capture");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Deletes captures older than `max_age` (best effort).
pub fn purge_old(max_age: Duration) {
    if let Ok(dir) = capture_dir() {
        crate::fileio::purge_older_than(&dir, max_age);
    }
}

/// A file name stem unique enough for one process: millisecond timestamp.
pub fn stamp() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

/// Captures every display. The shots stay in memory: the overlay pulls raw pixels over IPC, so no
/// image encoding sits between the grab and the selection UI.
pub fn capture_all() -> AppResult<Vec<DisplayShot>> {
    let monitors = Monitor::all()?;
    if monitors.is_empty() {
        return Err(AppError::capture("no displays found"));
    }
    super::perf::mark("monitors enumerated");
    let shots = monitors
        .iter()
        .map(|m| grab(m).map(|(monitor_id, bounds, scale, image)| DisplayShot { monitor_id, bounds, scale, image }))
        .collect::<AppResult<Vec<_>>>()?;
    super::perf::mark("displays grabbed");
    Ok(shots)
}

/// The display containing the given point (xcap native coordinates), unsaved.
pub fn grab_at(x: i32, y: i32) -> AppResult<(MonitorBounds, f32, RgbaImage)> {
    let (_, bounds, scale, image) = grab(&Monitor::from_point(x, y)?)?;
    Ok((bounds, scale, image))
}

/// Captures the display with the given xcap id again (Timed Snap).
pub fn recapture(monitor_id: u32) -> AppResult<RgbaImage> {
    let monitor = Monitor::all()?
        .into_iter()
        .find(|m| m.id().ok() == Some(monitor_id))
        .ok_or_else(|| AppError::capture("the display was disconnected during the countdown"))?;
    Ok(monitor.capture_image()?)
}

fn grab(monitor: &Monitor) -> AppResult<(u32, MonitorBounds, f32, RgbaImage)> {
    let bounds = MonitorBounds { x: monitor.x()?, y: monitor.y()?, width: monitor.width()?, height: monitor.height()? };
    Ok((monitor.id()?, bounds, monitor.scale_factor()?, monitor.capture_image()?))
}

/// PNG with fast compression: capture latency matters more than file size here.
pub fn write_png(image: &RgbaImage, path: &Path) -> AppResult<()> {
    let writer = BufWriter::new(File::create(path)?);
    PngEncoder::new_with_quality(writer, CompressionType::Fast, FilterType::Adaptive).write_image(
        image.as_raw(),
        image.width(),
        image.height(),
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(())
}
