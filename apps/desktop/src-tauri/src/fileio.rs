//! File IO, temp files for drag-out / copy-as-file, image format conversion and asset scoping.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use image::codecs::gif::GifEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat, RgbImage, RgbaImage};
use tauri::ipc::{Request, Response};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::ipc::{header, raw_body, required_header};

/// Files in the drag-out temp dir older than this are deleted lazily on the next `temp_write`.
const TEMP_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[tauri::command]
pub async fn file_read(path: String) -> AppResult<Response> {
    Ok(Response::new(std::fs::read(path)?))
}

/// Body: file bytes. Header `x-path`: destination (parent directories are created).
#[tauri::command]
pub async fn file_write(request: Request<'_>) -> AppResult<()> {
    let path = PathBuf::from(required_header(&request, "x-path")?);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, raw_body(&request)?)?;
    Ok(())
}

/// Body: file bytes. Header `x-name`: file name. Each export gets a unique directory so
/// another drag/copy cannot overwrite a file that Finder or a receiving app is still reading.
#[tauri::command]
pub async fn temp_write(request: Request<'_>) -> AppResult<String> {
    let name = required_header(&request, "x-name")?;
    let root = std::env::temp_dir().join("skritch");
    std::fs::create_dir_all(&root)?;
    purge_older_than(&root, TEMP_MAX_AGE);
    let path = write_temp_export(&root, &name, raw_body(&request)?)?;
    Ok(path.to_string_lossy().into_owned())
}

fn write_temp_export(root: &Path, name: &str, bytes: &[u8]) -> AppResult<PathBuf> {
    static NEXT_EXPORT: AtomicU64 = AtomicU64::new(0);
    let name = Path::new(name).file_name().ok_or_else(|| AppError::invalid("x-name must be a file name"))?;
    let time = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let sequence = NEXT_EXPORT.fetch_add(1, Ordering::Relaxed);
    let dir = root.join(format!("{}-{time}-{sequence}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(name);
    std::fs::write(&path, bytes)?;
    Ok(path)
}

/// Deletes files in `dir` last modified more than `max_age` ago (best effort).
pub fn purge_older_than(dir: &Path, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let expired = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| now.duration_since(t).unwrap_or_default() > max_age)
            .unwrap_or(false);
        if expired {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let _ = std::fs::remove_dir_all(entry.path());
            } else {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// Body: PNG bytes. Headers `x-format` (`jpg|tiff|bmp|gif|pdf`) and optional `x-quality` (0–1,
/// JPEG/PDF only, default 0.9). Returns the converted file bytes.
#[tauri::command]
pub async fn image_convert(request: Request<'_>) -> AppResult<Response> {
    let format = required_header(&request, "x-format")?;
    let quality = match header(&request, "x-quality")? {
        Some(q) => q.parse::<f32>().map_err(|_| AppError::invalid("x-quality must be a number"))?,
        None => 0.9,
    };
    Ok(Response::new(convert(raw_body(&request)?, &format, quality)?))
}

pub fn convert(png: &[u8], format: &str, quality: f32) -> AppResult<Vec<u8>> {
    let image = image::load_from_memory(png)?;
    let jpeg_quality = (quality.clamp(0.0, 1.0) * 100.0).round().clamp(1.0, 100.0) as u8;
    let mut out = Vec::new();
    match format {
        "jpg" | "jpeg" => encode_jpeg(&over_white(&image), jpeg_quality, &mut out)?,
        "bmp" => over_white(&image).write_to(&mut Cursor::new(&mut out), ImageFormat::Bmp)?,
        "tiff" | "tif" => image.to_rgba8().write_to(&mut Cursor::new(&mut out), ImageFormat::Tiff)?,
        "gif" => {
            // GIF has 1-bit alpha at best; flatten like the other opaque formats.
            let flat = DynamicImage::ImageRgb8(over_white(&image)).into_rgba8();
            GifEncoder::new_with_speed(&mut out, 10).encode(
                flat.as_raw(),
                flat.width(),
                flat.height(),
                image::ExtendedColorType::Rgba8,
            )?;
        }
        "pdf" => {
            let rgb = over_white(&image);
            let mut jpeg = Vec::new();
            encode_jpeg(&rgb, jpeg_quality, &mut jpeg)?;
            out = jpeg_to_pdf(&jpeg, rgb.width(), rgb.height());
        }
        other => return Err(AppError::unsupported(format!("unknown image format {other:?}"))),
    }
    Ok(out)
}

fn encode_jpeg(rgb: &RgbImage, quality: u8, out: &mut Vec<u8>) -> AppResult<()> {
    JpegEncoder::new_with_quality(out, quality).encode_image(rgb)?;
    Ok(())
}

/// Composites over white, dropping alpha (for formats without transparency).
fn over_white(image: &DynamicImage) -> RgbImage {
    let rgba: RgbaImage = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let blend = |c: u8| ((c as u32 * a as u32 + 255 * (255 - a as u32) + 127) / 255) as u8;
        image::Rgb([blend(r), blend(g), blend(b)])
    })
}

/// A single-page PDF showing one JPEG (DCTDecode) at 96 dpi, so it prints at on-screen size.
pub fn jpeg_to_pdf(jpeg: &[u8], width: u32, height: u32) -> Vec<u8> {
    let (pw, ph) = (width as f64 * 0.75, height as f64 * 0.75);
    let content = format!("q {pw:.2} 0 0 {ph:.2} 0 0 cm /Im0 Do Q");
    let objects: [Vec<u8>; 5] = [
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw:.2} {ph:.2}] \
             /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
        )
        .into_bytes(),
        [
            format!(
                "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB \
                 /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
                jpeg.len()
            )
            .as_bytes(),
            jpeg,
            b"\nendstream",
        ]
        .concat(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()).into_bytes(),
    ];

    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        pdf.extend_from_slice(body);
        pdf.extend_from_slice(b"\nendobj\n");
    }
    let xref_at = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n", objects.len() + 1).as_bytes(),
    );
    pdf
}

/// `~/Pictures/Skritch` (created if missing).
#[tauri::command]
pub fn default_save_dir(app: AppHandle) -> AppResult<String> {
    let pictures = app.path().picture_dir().or_else(|_| app.path().home_dir().map(|home| home.join("Pictures")))?;
    let dir = pictures.join("Skritch");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Lets `<video src={convertFileSrc(path)}>` load a file outside the static asset scope.
#[tauri::command]
pub fn allow_asset_path(app: AppHandle, path: String) -> AppResult<()> {
    app.asset_protocol_scope().allow_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successive_exports_preserve_name_and_previous_contents() {
        let root = std::env::temp_dir().join(format!("skritch-export-test-{}", std::process::id()));
        let first = write_temp_export(&root, "../Example.pdf", b"first").unwrap();
        let second = write_temp_export(&root, "Example.pdf", b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(first.file_name().unwrap(), "Example.pdf");
        assert!(first.starts_with(&root));
        assert_eq!(std::fs::read(&first).unwrap(), b"first");
        assert_eq!(std::fs::read(&second).unwrap(), b"second");
        assert!(write_temp_export(&root, "..", b"invalid").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    fn sample_png() -> Vec<u8> {
        // Left half opaque red, right half fully transparent.
        let image =
            RgbaImage::from_fn(
                8,
                4,
                |x, _| if x < 4 { image::Rgba([255, 0, 0, 255]) } else { image::Rgba([0, 0, 0, 0]) },
            );
        let mut png = Vec::new();
        image.write_to(&mut Cursor::new(&mut png), ImageFormat::Png).unwrap();
        png
    }

    #[test]
    fn opaque_formats_composite_over_white() {
        for format in ["bmp", "gif"] {
            let out = convert(&sample_png(), format, 0.9).unwrap();
            let decoded = image::load_from_memory(&out).unwrap().to_rgba8();
            assert_eq!(decoded.dimensions(), (8, 4), "{format}");
            assert_eq!(decoded.get_pixel(6, 1).0, [255, 255, 255, 255], "{format}");
            assert_eq!(decoded.get_pixel(1, 1).0, [255, 0, 0, 255], "{format}");
        }
        let jpg = image::load_from_memory(&convert(&sample_png(), "jpg", 1.0).unwrap()).unwrap().to_rgb8();
        assert!(jpg.get_pixel(7, 3).0.iter().all(|&c| c > 240));
    }

    #[test]
    fn tiff_keeps_alpha() {
        let out = convert(&sample_png(), "tiff", 0.9).unwrap();
        let decoded = image::load_from_memory(&out).unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(6, 1).0[3], 0);
    }

    #[test]
    fn pdf_is_well_formed() {
        let pdf = convert(&sample_png(), "pdf", 0.8).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.trim_end().ends_with("%%EOF"));
        assert!(text.contains("/MediaBox [0 0 6.00 3.00]"));
        assert!(text.contains("/Filter /DCTDecode"));

        // Every xref entry must point at its "N 0 obj" header, and startxref at the table. Byte
        // offsets, so work on the raw bytes (the JPEG is not UTF-8); everything after it is ASCII.
        let startxref: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        assert!(pdf[startxref..].starts_with(b"xref\n"));
        let table = std::str::from_utf8(&pdf[startxref..]).unwrap();
        for (n, line) in table.lines().skip(3).take(5).enumerate() {
            let offset: usize = line[..10].parse().unwrap();
            assert!(pdf[offset..].starts_with(format!("{} 0 obj", n + 1).as_bytes()), "object {}", n + 1);
        }
    }

    #[test]
    fn unknown_format_is_unsupported() {
        assert_eq!(convert(&sample_png(), "webp", 0.9).unwrap_err().code, "unsupported");
    }
}
