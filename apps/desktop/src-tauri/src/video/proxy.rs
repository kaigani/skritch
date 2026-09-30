//! Playback proxies for sources the WebView cannot play (plan §6.8 step 3): H.264 yuv420p, ≤1920 px
//! wide, GOP 30 for fast stepping. Cached in the app cache dir by source path + size + mtime.
//! Proxies are autorotated by ffmpeg, so their rotation is always 0.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use super::progress::{fraction, run_ffmpeg};
use super::{blocking, frame_index, probe, render};
use crate::error::{AppError, AppResult};

/// Proxies are for scrubbing, not delivery: a fixed ceiling is plenty at ≤1080p.
const PROXY_KBPS: u32 = 8_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyResult {
    pub proxy_path: String,
}

pub fn proxy_args(input: &Path, output: &Path, encoder: &str) -> Vec<String> {
    let mut args: Vec<String> =
        ["-hide_banner", "-nostdin", "-y", "-v", "error", "-progress", "pipe:1", "-nostats", "-i"]
            .map(String::from)
            .to_vec();
    args.push(input.to_string_lossy().into_owned());
    // First real video stream (not cover art) and the first audio stream if there is one.
    args.extend(["-map", "0:V:0", "-map", "0:a:0?", "-vf", "scale='trunc(min(1920,iw)/2)*2':-2"].map(String::from));
    args.extend(render::encoder_args(encoder, PROXY_KBPS));
    args.extend(
        ["-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].map(String::from),
    );
    args.push(output.to_string_lossy().into_owned());
    args
}

/// Transcodes (or reuses) the proxy for `input`, reporting progress in 0..=1.
pub fn make_proxy(
    input: &Path,
    cache_dir: &Path,
    encoder: &str,
    mut on_progress: impl FnMut(f64),
) -> AppResult<PathBuf> {
    let key = frame_index::cache_key(input)
        .ok_or_else(|| AppError::new("not_found", format!("cannot read {}", input.display())))?;
    let output = cache_dir.join(format!("{key}.mp4"));
    if output.is_file() {
        on_progress(1.0);
        return Ok(output);
    }
    std::fs::create_dir_all(cache_dir)?;
    // Written under a temporary name so an interrupted transcode is never mistaken for a cached one.
    let partial = cache_dir.join(format!("{key}.partial.mp4"));
    let duration = probe::stream_info(input)?.duration.unwrap_or(0.0);
    let result = run_ffmpeg(
        &proxy_args(input, &partial, encoder),
        |_| {},
        |p| on_progress(if p.done { 1.0 } else { fraction(p.out_time, duration) }),
    );
    if let Err(e) = result {
        let _ = std::fs::remove_file(&partial);
        return Err(e);
    }
    std::fs::rename(&partial, &output)?;
    Ok(output)
}

/// Emits `video://proxy { id, progress }` while transcoding; the proxy is added to the asset scope.
#[tauri::command]
pub async fn video_make_proxy(app: AppHandle, path: String, id: String) -> AppResult<ProxyResult> {
    let cache_dir = app.path().app_cache_dir()?.join("proxies");
    let handle = app.clone();
    let proxy = blocking(move || {
        let encoder = super::encoders()
            .h264
            .clone()
            .ok_or_else(|| AppError::unsupported("no working H.264 encoder in this ffmpeg"))?;
        make_proxy(Path::new(&path), &cache_dir, &encoder, |progress| {
            let _ = handle.emit("video://proxy", json!({ "id": id, "progress": progress }));
        })
    })
    .await?;
    app.asset_protocol_scope().allow_file(&proxy)?;
    Ok(ProxyResult { proxy_path: proxy.to_string_lossy().into_owned() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_args_scale_to_even_width_and_short_gop() {
        let args = proxy_args(Path::new("in.mkv"), Path::new("out.mp4"), "libopenh264").join(" ");
        assert!(args.contains("-i in.mkv -map 0:V:0 -map 0:a:0? -vf scale='trunc(min(1920,iw)/2)*2':-2"));
        assert!(args.contains("-c:v libopenh264 -b:v 8000k -g 30 -pix_fmt yuv420p"));
        assert!(args.ends_with("-movflags +faststart out.mp4"));
    }
}
