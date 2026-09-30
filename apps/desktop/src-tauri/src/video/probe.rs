//! `video_probe`: stream info + frame index for an imported clip (plan §6.3, §6.8).

use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::{blocking, frame_index, run_capture};
use crate::error::{AppError, AppResult};

/// What `video_probe` returns (docs/IPC.md `ClipInfo`). `width`/`height` are *display* dimensions
/// (rotation applied), matching `<video>.videoWidth/Height` and what ffmpeg renders.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInfo {
    pub path: String,
    pub display_name: String,
    pub container: String,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub duration_sec: f64,
    pub codec: String,
    pub has_audio: bool,
    /// Clockwise degrees to rotate the coded frames for display: 0, 90, 180 or 270.
    pub rotation: u32,
    pub frames_b64: String,
}

/// The parts of the ffprobe JSON we use.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamInfo {
    pub codec: String,
    /// Coded (unrotated) size.
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub duration: Option<f64>,
    pub rotation: u32,
    pub has_audio: bool,
    pub start_time: f64,
    pub format_name: String,
}

const SHOW_ENTRIES: &str = "stream=codec_type,codec_name,avg_frame_rate,r_frame_rate,width,height,nb_frames,duration\
:stream_tags=rotate:stream_side_data=rotation:stream_disposition=attached_pic:format=format_name,start_time,duration";

pub fn parse_stream_json(json: &str) -> AppResult<StreamInfo> {
    let root: Value = serde_json::from_str(json)?;
    let streams = root["streams"].as_array().map(Vec::as_slice).unwrap_or_default();
    // Cover art in audio files / MP4s shows up as a video stream flagged attached_pic.
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64() != Some(1))
        .ok_or_else(|| AppError::new("no_video", "the file has no video stream"))?;
    let format = &root["format"];
    let number = |v: &Value| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64());

    Ok(StreamInfo {
        codec: video["codec_name"].as_str().unwrap_or("unknown").to_string(),
        width: video["width"].as_u64().unwrap_or(0) as u32,
        height: video["height"].as_u64().unwrap_or(0) as u32,
        fps: parse_rate(&video["avg_frame_rate"]).or_else(|| parse_rate(&video["r_frame_rate"])),
        duration: number(&video["duration"]).or_else(|| number(&format["duration"])),
        rotation: rotation(video),
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
        start_time: number(&format["start_time"]).unwrap_or(0.0),
        format_name: format["format_name"].as_str().unwrap_or_default().to_string(),
    })
}

/// "30000/1001" → 29.97…; "0/0" and garbage → None.
fn parse_rate(value: &Value) -> Option<f64> {
    let (num, den) = value.as_str()?.split_once('/')?;
    let (num, den): (f64, f64) = (num.parse().ok()?, den.parse().ok()?);
    (num > 0.0 && den > 0.0).then(|| num / den)
}

/// Display-matrix side data holds a counter-clockwise angle; the legacy `rotate` tag is clockwise.
fn rotation(stream: &Value) -> u32 {
    let side_data = stream["side_data_list"]
        .as_array()
        .and_then(|list| list.iter().find_map(|d| d["rotation"].as_f64()))
        .map(|ccw| -ccw);
    let tag = stream["tags"]["rotate"].as_str().and_then(|s| s.parse::<f64>().ok());
    let degrees = side_data.or(tag).unwrap_or(0.0);
    (((degrees / 90.0).round() as i64).rem_euclid(4) * 90) as u32
}

/// Combines stream info and the frame index into a `ClipInfo`, filling gaps from each other.
pub fn clip_info(path: &Path, info: &StreamInfo, frames: &[f64]) -> ClipInfo {
    let measured_fps = match frames {
        [first, .., last] if last > first => Some((frames.len() - 1) as f64 / (last - first)),
        _ => None,
    };
    let fps = info.fps.or(measured_fps).unwrap_or(30.0);
    let duration_sec = info.duration.or_else(|| frames.last().map(|t| t + 1.0 / fps)).unwrap_or(0.0);
    let (width, height) = if info.rotation % 180 == 90 { (info.height, info.width) } else { (info.width, info.height) };
    let container = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| info.format_name.split(',').next().unwrap_or_default().to_string());
    ClipInfo {
        path: path.to_string_lossy().into_owned(),
        display_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        container,
        fps,
        width,
        height,
        duration_sec,
        codec: info.codec.clone(),
        has_audio: info.has_audio,
        rotation: info.rotation,
        frames_b64: frame_index::to_base64(frames),
    }
}

pub fn stream_info(path: &Path) -> AppResult<StreamInfo> {
    let args = ["-v", "error", "-show_entries", SHOW_ENTRIES, "-of", "json"]
        .iter()
        .map(|s| s.to_string())
        .chain([path.to_string_lossy().into_owned()])
        .collect::<Vec<_>>();
    let json = run_capture("ffprobe", &args)?;
    parse_stream_json(&String::from_utf8_lossy(&json))
}

pub fn probe(path: &Path, cache_dir: Option<&Path>) -> AppResult<ClipInfo> {
    let info = stream_info(path)?;
    let frames = frame_index::index(path, info.start_time, cache_dir)?;
    if frames.is_empty() {
        return Err(AppError::new("no_video", "the video stream has no frames"));
    }
    Ok(clip_info(path, &info, &frames))
}

/// Also adds the file to the asset-protocol scope so the frontend can play it right away.
#[tauri::command]
pub async fn video_probe(app: AppHandle, path: String) -> AppResult<ClipInfo> {
    let cache_dir = app.path().app_cache_dir().ok().map(|d| d.join("frames"));
    let _ = app.asset_protocol_scope().allow_file(&path);
    blocking(move || probe(Path::new(&path), cache_dir.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_h264_with_audio() {
        let info = parse_stream_json(include_str!("fixtures/bframes.json")).unwrap();
        assert_eq!(
            info,
            StreamInfo {
                codec: "h264".into(),
                width: 320,
                height: 240,
                fps: Some(30.0),
                duration: Some(1.0),
                rotation: 0,
                has_audio: true,
                start_time: 0.0,
                format_name: "mov,mp4,m4a,3gp,3g2,mj2".into(),
            }
        );
    }

    #[test]
    fn display_matrix_rotation_swaps_dimensions() {
        let info = parse_stream_json(include_str!("fixtures/rotated.json")).unwrap();
        // side_data rotation 90 (counter-clockwise) = rotate 270° clockwise for display.
        assert_eq!(info.rotation, 270);
        let clip = clip_info(Path::new("C:/v/Rotated.MP4"), &info, &[0.0, 1.0 / 30.0]);
        assert_eq!((clip.width, clip.height), (240, 320));
        assert_eq!((clip.container.as_str(), clip.display_name.as_str()), ("mp4", "Rotated.MP4"));
    }

    #[test]
    fn ntsc_rate_without_audio() {
        let info = parse_stream_json(include_str!("fixtures/ntsc.json")).unwrap();
        assert!((info.fps.unwrap() - 29.97003).abs() < 1e-5);
        assert!(!info.has_audio);
        assert_eq!(info.duration, Some(0.5005));
    }

    #[test]
    fn legacy_rotate_tag_and_fallbacks() {
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}},
            {"codec_type":"video","codec_name":"hevc","width":1920,"height":1080,"avg_frame_rate":"0/0",
             "r_frame_rate":"0/0","tags":{"rotate":"-90"}}],
            "format":{"format_name":"matroska,webm","start_time":"0.007000"}}"#;
        let info = parse_stream_json(json).unwrap();
        assert_eq!((info.codec.as_str(), info.rotation, info.fps, info.duration), ("hevc", 270, None, None));
        assert_eq!(info.start_time, 0.007);

        let clip = clip_info(Path::new("/tmp/noext"), &info, &[0.0, 0.04, 0.08]);
        assert!((clip.fps - 25.0).abs() < 1e-9);
        assert!((clip.duration_sec - 0.12).abs() < 1e-9);
        assert_eq!(clip.container, "matroska");
    }

    #[test]
    fn rejects_audio_only_files() {
        let json = r#"{"streams":[{"codec_type":"audio","codec_name":"mp3"}],"format":{}}"#;
        assert_eq!(parse_stream_json(json).unwrap_err().code, "no_video");
    }
}
