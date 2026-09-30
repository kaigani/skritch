//! Export: one ffmpeg invocation using trim/atrim + concat over the ORIGINAL files (plan §6.6).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use super::progress::{fraction, run_ffmpeg};
use super::Encoders;
use crate::error::{AppError, AppResult};

/// Above this total command-line length the graph goes to a `-filter_complex_script` file
/// (Windows caps command lines at 32 767 chars).
pub const MAX_INLINE_ARGS_LEN: usize = 30_000;

/// Trim points are shifted this much earlier. They come from ffprobe's 6-decimal pts, which may be
/// rounded *up* past the real timestamp; without the shift `trim` would drop the first frame of a
/// segment and keep the frame at its end. Far below any real frame interval.
const TRIM_EPSILON: f64 = 0.0005;

const AUDIO_RATE: u32 = 48_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
    pub out_path: String,
    pub format: RenderFormat,
    pub quality: Quality,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub audio: bool,
    pub inputs: Vec<RenderInput>,
    pub segments: Vec<RenderSegment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderInput {
    pub path: String,
    pub has_audio: bool,
}

/// `[start, end)` in seconds on the original file's timeline (frame-index pts).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct RenderSegment {
    pub input: usize,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum RenderFormat {
    #[serde(rename = "mp4-h264")]
    Mp4H264,
    #[serde(rename = "mp4-hevc")]
    Mp4Hevc,
    #[serde(rename = "mov")]
    Mov,
    #[serde(rename = "webm")]
    Webm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Low,
    Medium,
    High,
}

impl RenderFormat {
    fn video_encoder(self, encoders: &Encoders) -> AppResult<&str> {
        let (encoder, codec) = match self {
            RenderFormat::Mp4H264 | RenderFormat::Mov => (&encoders.h264, "H.264"),
            RenderFormat::Mp4Hevc => (&encoders.hevc, "HEVC"),
            RenderFormat::Webm => (&encoders.vp9, "VP9"),
        };
        encoder.as_deref().ok_or_else(|| AppError::unsupported(format!("no working {codec} encoder in this ffmpeg")))
    }

    /// Relative bitrate need versus H.264 for similar quality.
    fn bitrate_factor(self) -> f64 {
        match self {
            RenderFormat::Mp4H264 | RenderFormat::Mov => 1.0,
            RenderFormat::Mp4Hevc => 0.6,
            RenderFormat::Webm => 0.7,
        }
    }
}

impl RenderJob {
    fn validate(&self) -> AppResult<()> {
        if self.segments.is_empty() {
            return Err(AppError::invalid("nothing to render: the sequence is empty"));
        }
        // JSON cannot carry NaN, so plain comparisons suffice.
        if self.fps <= 0.0 || self.width < 2 || self.height < 2 {
            return Err(AppError::invalid("output size and fps must be positive"));
        }
        for (i, seg) in self.segments.iter().enumerate() {
            if seg.input >= self.inputs.len() {
                return Err(AppError::invalid(format!("segment {i} references missing input {}", seg.input)));
            }
            if seg.end <= seg.start || seg.start < 0.0 {
                return Err(AppError::invalid(format!("segment {i} has an empty or negative range")));
            }
        }
        Ok(())
    }

    /// Audio is rendered only if requested and at least one input actually has some.
    fn with_audio(&self) -> bool {
        self.audio && self.inputs.iter().any(|i| i.has_audio)
    }

    pub fn duration(&self) -> f64 {
        self.segments.iter().map(|s| s.end - s.start).sum()
    }

    /// yuv420p needs even dimensions.
    fn even_size(&self) -> (u32, u32) {
        ((self.width & !1).max(2), (self.height & !1).max(2))
    }
}

fn secs(t: f64) -> String {
    format!("{t:.6}")
}

/// ffmpeg rate syntax: integers as-is, NTSC rates as exact rationals (29.97 → 30000/1001).
pub fn fmt_rate(fps: f64) -> String {
    if (fps - fps.round()).abs() < 1e-6 {
        return format!("{}", fps.round() as u64);
    }
    let ntsc_base = (fps * 1.001).round();
    if (fps - ntsc_base / 1.001).abs() < 1e-3 {
        return format!("{}/1001", ntsc_base as u64 * 1000);
    }
    format!("{fps:.6}").trim_end_matches('0').to_string()
}

/// The `-filter_complex` graph: per segment a trimmed, letterboxed, rate-normalised video chain and
/// (if audio is on) a trimmed, resampled audio chain — silence from `anullsrc` for inputs without
/// audio — then one `concat`.
pub fn build_filtergraph(job: &RenderJob) -> AppResult<String> {
    job.validate()?;
    let (w, h) = job.even_size();
    let fps = fmt_rate(job.fps);
    let audio = job.with_audio();
    let mut chains = Vec::with_capacity(job.segments.len() * 2 + 1);
    let mut concat_inputs = String::new();

    for (k, seg) in job.segments.iter().enumerate() {
        let (start, end) = (secs((seg.start - TRIM_EPSILON).max(0.0)), secs(seg.end - TRIM_EPSILON));
        let i = seg.input;
        chains.push(format!(
            "[{i}:V]trim=start={start}:end={end},setpts=PTS-STARTPTS,\
             scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:-1:-1,setsar=1,\
             fps={fps},format=yuv420p[v{k}]"
        ));
        concat_inputs.push_str(&format!("[v{k}]"));
        if audio {
            chains.push(if job.inputs[i].has_audio {
                format!(
                    "[{i}:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS,\
                     aformat=sample_rates={AUDIO_RATE}:channel_layouts=stereo[a{k}]"
                )
            } else {
                format!("anullsrc=r={AUDIO_RATE}:cl=stereo,atrim=duration={}[a{k}]", secs(seg.end - seg.start))
            });
            concat_inputs.push_str(&format!("[a{k}]"));
        }
    }
    let n = job.segments.len();
    chains.push(if audio {
        format!("{concat_inputs}concat=n={n}:v=1:a=1[outv][outa]")
    } else {
        format!("{concat_inputs}concat=n={n}:v=1:a=0[outv]")
    });
    Ok(chains.join(";"))
}

/// How the filtergraph reaches ffmpeg.
pub enum GraphArg {
    Inline(String),
    Script(PathBuf),
}

/// Target video bitrate: bits per pixel per frame by quality, scaled per codec. 1080p30 H.264 is
/// 2.5 / 5 / 10 Mbit/s for low / medium / high.
fn video_kbps(job: &RenderJob) -> u32 {
    let bpp = match job.quality {
        Quality::Low => 0.04,
        Quality::Medium => 0.08,
        Quality::High => 0.16,
    };
    let (w, h) = job.even_size();
    let kbps = w as f64 * h as f64 * job.fps * bpp * job.format.bitrate_factor() / 1000.0;
    (kbps.round() as u32).max(200)
}

/// `-c:v` plus bitrate and per-encoder speed settings.
pub fn encoder_args(encoder: &str, kbps: u32) -> Vec<String> {
    let mut args = vec!["-c:v".to_string(), encoder.to_string(), "-b:v".to_string(), format!("{kbps}k")];
    let extra: &[&str] = match encoder {
        "libx264" | "libx265" => &["-preset", "fast"],
        "h264_nvenc" | "hevc_nvenc" => &["-preset", "p4"],
        "libvpx-vp9" => &["-deadline", "good", "-cpu-used", "4", "-row-mt", "1"],
        _ => &[],
    };
    args.extend(extra.iter().map(|s| s.to_string()));
    args
}

pub fn build_render_args(job: &RenderJob, encoders: &Encoders, graph: &GraphArg) -> AppResult<Vec<String>> {
    job.validate()?;
    let encoder = job.format.video_encoder(encoders)?;
    let mut args: Vec<String> =
        ["-hide_banner", "-nostdin", "-y", "-v", "error", "-progress", "pipe:1", "-nostats"].map(String::from).to_vec();
    for input in &job.inputs {
        args.extend(["-i".to_string(), input.path.clone()]);
    }
    match graph {
        GraphArg::Inline(graph) => args.extend(["-filter_complex".to_string(), graph.clone()]),
        GraphArg::Script(path) => {
            args.extend(["-filter_complex_script".to_string(), path.to_string_lossy().into_owned()])
        }
    }
    args.extend(["-map".to_string(), "[outv]".to_string()]);
    let audio = job.with_audio();
    if audio {
        args.extend(["-map".to_string(), "[outa]".to_string()]);
    }
    args.extend(encoder_args(encoder, video_kbps(job)));
    if audio {
        let (codec, bitrate) = if job.format == RenderFormat::Webm { ("libopus", "128k") } else { ("aac", "160k") };
        args.extend(["-c:a", codec, "-b:a", bitrate].map(String::from));
    } else {
        args.push("-an".to_string());
    }
    if job.format == RenderFormat::Mp4Hevc {
        // QuickTime / Safari only play HEVC-in-MP4 tagged as hvc1.
        args.extend(["-tag:v", "hvc1"].map(String::from));
    }
    if job.format != RenderFormat::Webm {
        args.extend(["-movflags", "+faststart"].map(String::from));
    }
    args.push(job.out_path.clone());
    Ok(args)
}

/// Total command-line length as Windows would see it (roughly: quotes + separators).
fn command_line_len(args: &[String]) -> usize {
    args.iter().map(|a| a.len() + 3).sum()
}

/// Builds the final args, spilling the graph to `script_path` when the command line would be too
/// long. Returns the args and the script file to delete afterwards, if one was written.
pub fn prepare_args(
    job: &RenderJob,
    encoders: &Encoders,
    script_path: &Path,
) -> AppResult<(Vec<String>, Option<PathBuf>)> {
    let graph = build_filtergraph(job)?;
    let inline = build_render_args(job, encoders, &GraphArg::Inline(graph.clone()))?;
    if command_line_len(&inline) <= MAX_INLINE_ARGS_LEN {
        return Ok((inline, None));
    }
    std::fs::write(script_path, graph)?;
    let args = build_render_args(job, encoders, &GraphArg::Script(script_path.to_path_buf()))?;
    Ok((args, Some(script_path.to_path_buf())))
}

struct RunningJob {
    out_path: PathBuf,
    cancelled: Arc<AtomicBool>,
    child: Option<Arc<Mutex<Child>>>,
}

#[derive(Default)]
pub struct RenderJobs {
    next_id: AtomicU64,
    running: Mutex<HashMap<String, RunningJob>>,
}

/// Starts a render in the background and returns its job id. Outcome events:
/// `video://render` (progress), then exactly one of `video://render-done` or `video://render-error`
/// (message `"cancelled"` after `video_cancel`). Failed or cancelled output files are deleted.
#[tauri::command]
pub fn video_render(app: AppHandle, jobs: State<'_, RenderJobs>, job: RenderJob) -> AppResult<String> {
    job.validate()?;
    let job_id = format!("render-{}", jobs.next_id.fetch_add(1, Ordering::SeqCst) + 1);
    let cancelled = Arc::new(AtomicBool::new(false));
    let out_path = PathBuf::from(&job.out_path);
    jobs.running
        .lock()
        .unwrap()
        .insert(job_id.clone(), RunningJob { out_path: out_path.clone(), cancelled: cancelled.clone(), child: None });

    let id = job_id.clone();
    std::thread::spawn(move || {
        let result = render(&app, &id, &job);
        app.state::<RenderJobs>().running.lock().unwrap().remove(&id);
        let error = match result {
            _ if cancelled.load(Ordering::SeqCst) => Some("cancelled".to_string()),
            Ok(()) => None,
            Err(e) => Some(e.message),
        };
        match error {
            None => {
                let _ = app.emit("video://render-done", json!({ "jobId": id, "path": job.out_path }));
            }
            Some(message) => {
                let _ = std::fs::remove_file(&out_path);
                let _ = app.emit("video://render-error", json!({ "jobId": id, "message": message }));
            }
        }
    });
    Ok(job_id)
}

fn render(app: &AppHandle, job_id: &str, job: &RenderJob) -> AppResult<()> {
    let encoders = super::encoders();
    let script_path = std::env::temp_dir().join(format!("skritch-{}-{job_id}.graph", std::process::id()));
    let (args, script) = prepare_args(job, encoders, &script_path)?;
    if let Some(parent) = Path::new(&job.out_path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let total = job.duration();
    let started = Instant::now();
    let result = run_ffmpeg(
        &args,
        |child| {
            let jobs = app.state::<RenderJobs>();
            let mut running = jobs.running.lock().unwrap();
            if let Some(entry) = running.get_mut(job_id) {
                if entry.cancelled.load(Ordering::SeqCst) {
                    let _ = child.lock().unwrap().kill();
                }
                entry.child = Some(child);
            }
        },
        |p| {
            let progress = if p.done { 1.0 } else { fraction(p.out_time, total) };
            let elapsed = started.elapsed().as_secs_f64();
            let eta_sec = (progress > 0.0).then(|| elapsed * (1.0 - progress) / progress);
            let _ = app.emit(
                "video://render",
                json!({ "jobId": job_id, "progress": progress, "frame": p.frame, "fps": p.fps, "etaSec": eta_sec }),
            );
        },
    );
    if let Some(script) = script {
        let _ = std::fs::remove_file(script);
    }
    result
}

/// Kills the job's ffmpeg; the job thread then deletes the partial file and reports "cancelled".
/// Unknown / finished job ids are ignored.
#[tauri::command]
pub fn video_cancel(jobs: State<'_, RenderJobs>, job_id: String) {
    if let Some(job) = jobs.running.lock().unwrap().get(&job_id) {
        job.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = &job.child {
            let _ = child.lock().unwrap().kill();
        }
    }
}

/// On app exit: kill every render and remove its partial output.
pub fn cancel_all(jobs: &RenderJobs) {
    for job in jobs.running.lock().unwrap().values() {
        job.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = &job.child {
            let mut child = child.lock().unwrap();
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_file(&job.out_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two_input_job() -> RenderJob {
        RenderJob {
            out_path: "C:/out/final.mp4".into(),
            format: RenderFormat::Mp4H264,
            quality: Quality::High,
            width: 1920,
            height: 1080,
            fps: 30.0,
            audio: true,
            inputs: vec![
                RenderInput { path: "C:/clips/a.mp4".into(), has_audio: true },
                RenderInput { path: "C:/clips/b screen.mov".into(), has_audio: false },
            ],
            segments: vec![
                RenderSegment { input: 0, start: 0.0, end: 10.0 },
                RenderSegment { input: 1, start: 2.502, end: 7.002 },
                RenderSegment { input: 0, start: 12.5, end: 13.0 },
            ],
        }
    }

    fn encoders() -> Encoders {
        Encoders { h264: Some("h264_nvenc".into()), hevc: None, vp9: Some("libvpx-vp9".into()) }
    }

    #[test]
    fn filtergraph_for_two_inputs_one_without_audio() {
        let graph = build_filtergraph(&two_input_job()).unwrap();
        let expected = [
            "[0:V]trim=start=0.000000:end=9.999500,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,setsar=1,fps=30,format=yuv420p[v0]",
            "[0:a]atrim=start=0.000000:end=9.999500,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a0]",
            "[1:V]trim=start=2.501500:end=7.001500,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,setsar=1,fps=30,format=yuv420p[v1]",
            "anullsrc=r=48000:cl=stereo,atrim=duration=4.500000[a1]",
            "[0:V]trim=start=12.499500:end=12.999500,setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,setsar=1,fps=30,format=yuv420p[v2]",
            "[0:a]atrim=start=12.499500:end=12.999500,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a2]",
            "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]",
        ]
        .join(";");
        assert_eq!(graph, expected);
    }

    #[test]
    fn video_only_graph_when_audio_is_muted() {
        let mut job = two_input_job();
        job.audio = false;
        job.width = 1281; // odd sizes are rounded down to even
        job.fps = 30000.0 / 1001.0;
        let graph = build_filtergraph(&job).unwrap();
        assert!(!graph.contains("atrim") && !graph.contains("anullsrc"));
        assert!(graph.contains("scale=1280:1080:") && graph.contains("fps=30000/1001"));
        assert!(graph.ends_with("[v0][v1][v2]concat=n=3:v=1:a=0[outv]"));
    }

    #[test]
    fn render_args_for_mp4() {
        let job = two_input_job();
        let args = build_render_args(&job, &encoders(), &GraphArg::Inline("G".into())).unwrap();
        assert_eq!(
            args.join(" | "),
            [
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-progress",
                "pipe:1",
                "-nostats",
                "-i",
                "C:/clips/a.mp4",
                "-i",
                "C:/clips/b screen.mov",
                "-filter_complex",
                "G",
                "-map",
                "[outv]",
                "-map",
                "[outa]",
                "-c:v",
                "h264_nvenc",
                "-b:v",
                "9953k",
                "-preset",
                "p4",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                "C:/out/final.mp4",
            ]
            .join(" | ")
        );
    }

    #[test]
    fn webm_uses_vp9_and_opus_without_faststart() {
        let mut job = two_input_job();
        job.format = RenderFormat::Webm;
        let args = build_render_args(&job, &encoders(), &GraphArg::Script("g.txt".into())).unwrap().join(" ");
        assert!(args.contains("-filter_complex_script g.txt"));
        assert!(args.contains("-c:v libvpx-vp9") && args.contains("-c:a libopus -b:a 128k"));
        assert!(!args.contains("faststart"));
    }

    #[test]
    fn missing_encoder_is_unsupported() {
        let mut job = two_input_job();
        job.format = RenderFormat::Mp4Hevc;
        let err = build_render_args(&job, &encoders(), &GraphArg::Inline("G".into())).unwrap_err();
        assert_eq!(err.code, "unsupported");
    }

    #[test]
    fn long_graphs_spill_to_a_script_file() {
        let mut job = two_input_job();
        job.segments = (0..300).map(|i| RenderSegment { input: i % 2, start: i as f64, end: i as f64 + 0.5 }).collect();
        let script = std::env::temp_dir().join(format!("skritch-test-{}.graph", std::process::id()));
        let (args, written) = prepare_args(&job, &encoders(), &script).unwrap();
        assert_eq!(written.as_deref(), Some(script.as_path()));
        assert!(args.contains(&"-filter_complex_script".to_string()));
        assert_eq!(std::fs::read_to_string(&script).unwrap(), build_filtergraph(&job).unwrap());
        std::fs::remove_file(script).unwrap();
    }

    #[test]
    fn rejects_invalid_jobs() {
        let mut job = two_input_job();
        job.segments[1].input = 5;
        assert!(build_filtergraph(&job).is_err());
        job.segments = vec![RenderSegment { input: 0, start: 2.0, end: 2.0 }];
        assert!(build_filtergraph(&job).is_err());
        job.segments.clear();
        assert!(build_filtergraph(&job).is_err());
    }

    #[test]
    fn job_deserialises_from_ipc_json() {
        let job: RenderJob = serde_json::from_str(
            r#"{"outPath":"o.webm","format":"mp4-hevc","quality":"low","width":640,"height":360,"fps":25,
                "audio":false,"inputs":[{"path":"a.mp4","hasAudio":true}],"segments":[{"input":0,"start":0,"end":1.5}]}"#,
        )
        .unwrap();
        assert_eq!((job.format, job.quality, job.duration()), (RenderFormat::Mp4Hevc, Quality::Low, 1.5));
    }

    #[test]
    fn formats_rates() {
        assert_eq!(fmt_rate(30.0), "30");
        assert_eq!(fmt_rate(30000.0 / 1001.0), "30000/1001");
        assert_eq!(fmt_rate(24000.0 / 1001.0), "24000/1001");
        assert_eq!(fmt_rate(12.5), "12.5");
    }
}
