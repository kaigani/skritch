//! Clipboard access via arboard (images) and clipboard-win (file lists, Windows only).

use std::borrow::Cow;

use arboard::{Clipboard, ImageData};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ImageEncoder;
use tauri::ipc::{Request, Response};

use crate::error::{AppError, AppResult};
use crate::ipc::raw_body;

fn clipboard_error(e: arboard::Error) -> AppError {
    AppError::new("clipboard", e.to_string())
}

/// The clipboard image as PNG bytes; an empty body means "no image on the clipboard".
#[tauri::command]
pub async fn clipboard_read_image() -> AppResult<Response> {
    let mut clipboard = Clipboard::new().map_err(clipboard_error)?;
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(arboard::Error::ContentNotAvailable) => return Ok(Response::new(Vec::new())),
        Err(e) => return Err(clipboard_error(e)),
    };
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Adaptive).write_image(
        &image.bytes,
        image.width as u32,
        image.height as u32,
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(Response::new(png))
}

/// Body: PNG (or any format the `image` crate decodes) bytes.
#[tauri::command]
pub async fn clipboard_write_image(request: Request<'_>) -> AppResult<()> {
    let image = image::load_from_memory(raw_body(&request)?)?.into_rgba8();
    let data = ImageData {
        width: image.width() as usize,
        height: image.height() as usize,
        bytes: Cow::Owned(image.into_raw()),
    };
    Clipboard::new().and_then(|mut c| c.set_image(data)).map_err(clipboard_error)
}

/// Puts files on the clipboard as CF_HDROP ("Copy as file"); pasting in Explorer copies them.
#[tauri::command]
pub fn clipboard_write_files(paths: Vec<String>) -> AppResult<()> {
    if paths.is_empty() {
        return Err(AppError::invalid("no paths given"));
    }
    #[cfg(windows)]
    {
        let error = |e: clipboard_win::ErrorCode| AppError::new("clipboard", e.to_string());
        let _open = clipboard_win::Clipboard::new_attempts(10).map_err(error)?;
        clipboard_win::raw::set_file_list(&paths).map_err(error)
    }
    #[cfg(target_os = "macos")]
    {
        if crate::macos::write_file_urls(&paths) {
            Ok(())
        } else {
            Err(AppError::new("clipboard", "the pasteboard refused the files"))
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err(AppError::unsupported("copying files to the clipboard is not implemented on this platform"))
    }
}

#[tauri::command]
pub fn clipboard_read_text() -> AppResult<Option<String>> {
    match Clipboard::new().and_then(|mut c| c.get_text()) {
        Ok(text) => Ok(Some(text)),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => Err(clipboard_error(e)),
    }
}
#[tauri::command]
pub fn clipboard_write_text(text: String) -> AppResult<()> {
    Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(clipboard_error)
}
