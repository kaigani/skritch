//! Video pipeline on top of the ffmpeg / ffprobe CLIs (plan §6).
//!
//! Binaries are looked up as Tauri-style sidecars next to the executable first and then on `PATH`
//! (see DECISIONS.md). They always run without a console window and with args passed as an array.

pub mod frame_index;
pub mod frame_png;
pub mod probe;
pub mod progress;
pub mod proxy;
pub mod render;

#[cfg(test)]
mod e2e_tests;

use std::collections::HashSet;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// `ffmpeg` / `ffprobe`: a sidecar next to the executable (`<name>-<target-triple>[.exe]` as laid out
/// by `externalBin`, or plain `<name>[.exe]`), falling back to the bare name resolved via `PATH`.
pub fn tool_path(name: &str) -> PathBuf {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from));
    if let Some(dir) = exe_dir {
        let suffix = std::env::consts::EXE_SUFFIX;
        let triple = env!("SKRITCH_TARGET_TRIPLE");
        for file in [format!("{name}-{triple}{suffix}"), format!("{name}{suffix}")] {
            let candidate = dir.join(file);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    // GUI apps on macOS don't inherit the shell PATH, so look in the usual Homebrew prefixes too.
    #[cfg(target_os = "macos")]
    for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let candidate = std::path::Path::new(dir).join(name);
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(name)
}

/// A `Command` for a tool with stdin closed and, on Windows, no console window.
pub fn command(name: &str) -> Command {
    let mut cmd = Command::new(tool_path(name));
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Runs a tool to completion and returns stdout; a non-zero exit becomes an error carrying the
/// tail of stderr.
pub fn run_capture(name: &str, args: &[String]) -> AppResult<Vec<u8>> {
    let output =
        command(name).args(args).output().map_err(|e| AppError::ffmpeg(format!("could not run {name}: {e}")))?;
    if !output.status.success() {
        return Err(AppError::ffmpeg(format!("{name} failed: {}", stderr_tail(&output.stderr))));
    }
    Ok(output.stdout)
}

/// The last few lines of a tool's stderr, for error messages.
pub fn stderr_tail(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(6)..].join("\n")
}

/// Runs blocking work (process spawning, file IO) off the async runtime's worker threads.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| AppError::new("internal", e.to_string()))?
}

/// The encoder chosen per codec (`video_encoders`); `None` when nothing usable exists.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Encoders {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h264: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hevc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vp9: Option<String>,
}

#[cfg(windows)]
const H264_PLATFORM: &[&str] = &["h264_nvenc", "h264_amf", "h264_qsv", "h264_mf"];
#[cfg(windows)]
const HEVC_PLATFORM: &[&str] = &["hevc_nvenc", "hevc_amf", "hevc_qsv", "hevc_mf"];
#[cfg(target_os = "macos")]
const H264_PLATFORM: &[&str] = &["h264_videotoolbox"];
#[cfg(target_os = "macos")]
const HEVC_PLATFORM: &[&str] = &["hevc_videotoolbox"];
#[cfg(not(any(windows, target_os = "macos")))]
const H264_PLATFORM: &[&str] = &[];
#[cfg(not(any(windows, target_os = "macos")))]
const HEVC_PLATFORM: &[&str] = &[];

/// Software fallbacks after the platform encoders. libx264/libx265 only exist in GPL builds of
/// ffmpeg (fine for development; the shipped LGPL sidecar will not list them).
const H264_FALLBACK: &[&str] = &["libopenh264", "libx264"];
const HEVC_FALLBACK: &[&str] = &["libx265"];
const VP9_CANDIDATES: &[&str] = &["libvpx-vp9"];

/// Probed once per process (first call blocks; startup warms it on a background thread).
pub fn encoders() -> &'static Encoders {
    static ENCODERS: OnceLock<Encoders> = OnceLock::new();
    ENCODERS.get_or_init(|| {
        let listing = run_capture("ffmpeg", &["-hide_banner".into(), "-encoders".into()]).unwrap_or_default();
        let available = parse_encoder_list(&String::from_utf8_lossy(&listing));
        let pick = |candidates: &[&[&str]]| {
            candidates
                .iter()
                .flat_map(|list| list.iter())
                .find(|name| available.contains(**name) && encoder_works(name))
                .map(|name| name.to_string())
        };
        Encoders {
            h264: pick(&[H264_PLATFORM, H264_FALLBACK]),
            hevc: pick(&[HEVC_PLATFORM, HEVC_FALLBACK]),
            vp9: pick(&[VP9_CANDIDATES]),
        }
    })
}

/// Names from `ffmpeg -encoders` output (lines like ` V....D h264_nvenc   NVIDIA NVENC …`).
pub fn parse_encoder_list(text: &str) -> HashSet<String> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            let name = parts.next()?;
            // The legend at the top (" V..... = Video") has the same shape but "=" as its name.
            let is_entry = flags.len() == 6 && matches!(flags.as_bytes()[0], b'V' | b'A' | b'S') && name != "=";
            is_entry.then(|| name.to_string())
        })
        .collect()
}

/// Hardware encoders are listed whenever ffmpeg was built with them, even without the GPU; a tiny
/// test encode tells us whether one actually works on this machine.
fn encoder_works(name: &str) -> bool {
    let args = [
        "-hide_banner",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=30",
        "-frames:v",
        "3",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        name,
        "-f",
        "null",
        "-",
    ]
    .map(String::from);
    run_capture("ffmpeg", &args).is_ok()
}

#[tauri::command]
pub async fn video_encoders() -> AppResult<Encoders> {
    blocking(|| Ok(encoders().clone())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_encoder_listing() {
        let text = "Encoders:\n V..... = Video\n A..... = Audio\n ------\n V....D libx264              libx264 H.264\n V..... h264_qsv             H.264 (Intel Quick Sync Video acceleration) (codec h264)\n A....D aac                  AAC (Advanced Audio Coding)\n";
        let names = parse_encoder_list(text);
        assert!(names.contains("libx264") && names.contains("h264_qsv") && names.contains("aac"));
        assert!(!names.contains("="), "legend lines must be skipped");
        assert_eq!(names.len(), 3);
    }

    #[test]
    fn stderr_tail_keeps_last_lines() {
        let text = (1..=10).map(|i| format!("line {i}\n")).collect::<String>();
        assert_eq!(stderr_tail(text.as_bytes()), "line 5\nline 6\nline 7\nline 8\nline 9\nline 10");
    }
}
