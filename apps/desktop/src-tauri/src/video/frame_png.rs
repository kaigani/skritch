//! Single-frame extraction: full-resolution frame PNGs (plan §6.7) and timeline thumbnails.

use std::path::Path;

use tauri::ipc::Response;

use super::{blocking, run_capture};
use crate::error::{AppError, AppResult};

/// Seek slightly before the requested pts. Frame-index timestamps are printed with 6 decimals, so
/// the exact value may round *up* past the real pts; accurate seeking would then skip that frame.
/// 1 ms is far below any real frame interval.
const SEEK_EPSILON: f64 = 0.001;

fn seek_arg(pts_time: f64) -> String {
    format!("{:.6}", (pts_time - SEEK_EPSILON).max(0.0))
}

/// `-ss` before `-i` = accurate input seek: decodes from the preceding keyframe and drops frames
/// before the target, so the first output frame is the one at `pts_time`. Autorotation is
/// replaced by the explicit `rotation` (clockwise degrees, as returned by `video_probe`).
pub fn frame_png_args(path: &Path, pts_time: f64, rotation: u32) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-v", "error", "-noautorotate", "-ss"].map(String::from).to_vec();
    args.push(seek_arg(pts_time));
    args.extend(["-i".to_string(), path.to_string_lossy().into_owned()]);
    let rotate = match rotation % 360 {
        90 => Some("transpose=clock"),
        180 => Some("hflip,vflip"),
        270 => Some("transpose=cclock"),
        _ => None,
    };
    if let Some(filter) = rotate {
        args.extend(["-vf".to_string(), filter.to_string()]);
    }
    args.extend(
        ["-frames:v", "1", "-fps_mode", "passthrough", "-f", "image2pipe", "-c:v", "png", "-"].map(String::from),
    );
    args
}

pub fn thumbnail_args(path: &Path, pts_time: f64, height: u32) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-v", "error", "-ss"].map(String::from).to_vec();
    args.push(seek_arg(pts_time));
    args.extend(["-i".to_string(), path.to_string_lossy().into_owned(), "-vf".to_string()]);
    args.push(format!("scale=-2:{}", height.max(2)));
    args.extend(["-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"].map(String::from));
    args
}

pub fn extract(args: &[String]) -> AppResult<Vec<u8>> {
    let png = run_capture("ffmpeg", args)?;
    if png.is_empty() {
        return Err(AppError::ffmpeg("no frame at that position"));
    }
    Ok(png)
}

#[tauri::command]
pub async fn video_frame_png(path: String, pts_time: f64, rotation: u32) -> AppResult<Response> {
    blocking(move || extract(&frame_png_args(Path::new(&path), pts_time, rotation)).map(Response::new)).await
}

#[tauri::command]
pub async fn video_thumbnail(path: String, pts_time: f64, height: u32) -> AppResult<Response> {
    blocking(move || extract(&thumbnail_args(Path::new(&path), pts_time, height)).map(Response::new)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_args_seek_before_input_and_rotate_explicitly() {
        let args = frame_png_args(Path::new("in.mov"), 1.5, 90).join(" ");
        assert_eq!(
            args,
            "-hide_banner -v error -noautorotate -ss 1.499000 -i in.mov -vf transpose=clock \
             -frames:v 1 -fps_mode passthrough -f image2pipe -c:v png -"
        );
        assert!(frame_png_args(Path::new("in.mov"), 0.0, 0).join(" ").contains("-ss 0.000000 -i in.mov -frames:v 1"));
    }

    #[test]
    fn thumbnail_args_scale_to_height() {
        let args = thumbnail_args(Path::new("a b.mp4"), 0.0, 160);
        assert!(args.contains(&"a b.mp4".to_string()));
        assert!(args.contains(&"scale=-2:160".to_string()));
    }
}
