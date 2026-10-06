//! End-to-end checks against the real ffmpeg/ffprobe on PATH (skipped when they are missing):
//! probe → frame PNG → 2-segment render → proxy on synthetic `testsrc2` clips.

use std::path::{Path, PathBuf};

use base64::Engine;

use super::render::{self, Quality, RenderFormat, RenderInput, RenderJob, RenderSegment};
use super::{command, encoders, frame_png, probe, progress, proxy, run_capture};

fn tools_available() -> bool {
    ["ffmpeg", "ffprobe"]
        .iter()
        .all(|tool| command(tool).arg("-version").output().map(|o| o.status.success()).unwrap_or(false))
}

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("skritch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}

/// 2 s of 320×240 @ 30 fps test pattern, short GOP with B-frames where the encoder supports them.
fn make_clip(dir: &Path, name: &str, with_audio: bool) -> PathBuf {
    let out = dir.join(name);
    let mut args = strings(&["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30"]);
    if with_audio {
        args.extend(strings(&["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-c:a", "aac"]));
    }
    // LGPL sidecars have no libx264 (the default MP4 encoder). Use the same tested
    // platform encoder as the application instead of requiring a GPL development build.
    let encoder = encoders().h264.as_deref().expect("a working H.264 encoder");
    args.extend(strings(&["-t", "2", "-g", "10", "-bf", "2", "-pix_fmt", "yuv420p", "-c:v", encoder]));
    args.extend(strings(render::encoder_options(encoder)));
    args.push(out.to_string_lossy().into_owned());
    run_capture("ffmpeg", &args).expect("generating a test clip");
    out
}

fn decode_frames(b64: &str) -> Vec<f64> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
    bytes.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect()
}

#[test]
fn probe_frame_png_and_render_end_to_end() {
    if !tools_available() {
        eprintln!("skipping: ffmpeg/ffprobe not found");
        return;
    }
    let dir = TempDir::new("e2e");
    let silent = make_clip(&dir.0, "silent.mp4", false);
    let tone = make_clip(&dir.0, "tone.mp4", true);

    // Probe (twice: the second run is served from the frame-index cache).
    let cache = dir.0.join("cache");
    let clip = probe::probe(&silent, Some(&cache)).unwrap();
    assert_eq!((clip.width, clip.height, clip.fps, clip.has_audio, clip.rotation), (320, 240, 30.0, false, 0));
    assert!((clip.duration_sec - 2.0).abs() < 0.05, "duration {}", clip.duration_sec);
    let frames = decode_frames(&clip.frames_b64);
    assert_eq!(frames.len(), 60);
    assert!(frames.windows(2).all(|w| w[0] < w[1]));
    assert_eq!(probe::probe(&silent, Some(&cache)).unwrap().frames_b64, clip.frames_b64);
    assert!(std::fs::read_dir(&cache).unwrap().count() == 1, "frame index cached");
    assert!(probe::probe(&tone, None).unwrap().has_audio);

    // Frame 15 via accurate seek must equal frame 15 selected by decode order.
    let png = frame_png::extract(&frame_png::frame_png_args(&silent, frames[15], 0)).unwrap();
    let mut reference_args = strings(&["-v", "error", "-i"]);
    reference_args.push(silent.to_string_lossy().into_owned());
    reference_args.extend(strings(&[
        "-vf",
        "select='eq(n,15)'",
        "-frames:v",
        "1",
        "-fps_mode",
        "passthrough",
        "-f",
        "image2pipe",
        "-c:v",
        "png",
        "-",
    ]));
    let reference = run_capture("ffmpeg", &reference_args).unwrap();
    let (ours, theirs) = (image::load_from_memory(&png).unwrap(), image::load_from_memory(&reference).unwrap());
    assert_eq!(ours.to_rgba8(), theirs.to_rgba8(), "frame_png returned the wrong frame");
    let neighbour = frame_png::extract(&frame_png::frame_png_args(&silent, frames[16], 0)).unwrap();
    assert_ne!(image::load_from_memory(&neighbour).unwrap().to_rgba8(), theirs.to_rgba8());

    let thumb = frame_png::extract(&frame_png::thumbnail_args(&silent, 0.0, 60)).unwrap();
    assert_eq!(image::load_from_memory(&thumb).unwrap().height(), 60);

    // Render frames [15, 45) of the silent clip + the first second of the tone clip.
    let out = dir.0.join("out.mp4");
    let job = RenderJob {
        out_path: out.to_string_lossy().into_owned(),
        format: RenderFormat::Mp4H264,
        quality: Quality::Low,
        width: 320,
        height: 240,
        fps: 30.0,
        audio: true,
        inputs: vec![
            RenderInput { path: silent.to_string_lossy().into_owned(), has_audio: false },
            RenderInput { path: tone.to_string_lossy().into_owned(), has_audio: true },
        ],
        segments: vec![
            RenderSegment { input: 0, start: frames[15], end: frames[45] },
            RenderSegment { input: 1, start: 0.0, end: 1.0 },
        ],
    };
    let (args, _) = render::prepare_args(&job, encoders(), &dir.0.join("graph.txt")).unwrap();
    let mut last = None;
    progress::run_ffmpeg(&args, |_| {}, |p| last = Some(p)).unwrap();
    assert!(last.expect("progress was reported").done);

    let rendered = probe::probe(&out, None).unwrap();
    assert!((rendered.duration_sec - 2.0).abs() < 0.05, "rendered duration {}", rendered.duration_sec);
    assert_eq!(decode_frames(&rendered.frames_b64).len(), 60);
    assert!(rendered.has_audio);
    assert_eq!((rendered.width, rendered.height), (320, 240));

    // Proxy: same frame count, reported progress reaches 1, second call is a cache hit.
    let h264 = encoders().h264.clone().expect("an H.264 encoder");
    let proxies = dir.0.join("proxies");
    let mut reported = Vec::new();
    let proxy = proxy::make_proxy(&tone, &proxies, &h264, |p| reported.push(p)).unwrap();
    assert_eq!(reported.last(), Some(&1.0));
    let proxied = probe::probe(&proxy, None).unwrap();
    assert_eq!((decode_frames(&proxied.frames_b64).len(), proxied.has_audio), (60, true));
    assert_eq!(proxy::make_proxy(&tone, &proxies, &h264, |_| {}).unwrap(), proxy);
    assert_eq!(std::fs::read_dir(&proxies).unwrap().count(), 1, "no partial file left behind");
}
