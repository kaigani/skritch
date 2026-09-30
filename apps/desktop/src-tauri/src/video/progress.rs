//! Long-running ffmpeg jobs (proxy, render) with progress parsed from `-progress pipe:1`: blocks of
//! `key=value` lines, each terminated by `progress=continue` or `progress=end`.

use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};

use super::{command, stderr_tail};
use crate::error::{AppError, AppResult};

/// Runs ffmpeg (whose `args` must include `-progress pipe:1`), calling `on_progress` after every
/// progress block. `on_spawn` receives the child so another thread can kill it (cancel).
pub fn run_ffmpeg(
    args: &[String],
    on_spawn: impl FnOnce(Arc<Mutex<Child>>),
    mut on_progress: impl FnMut(Progress),
) -> AppResult<()> {
    let mut child = command("ffmpeg")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::ffmpeg(format!("could not run ffmpeg: {e}")))?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let child = Arc::new(Mutex::new(child));
    on_spawn(child.clone());

    // Drained concurrently so a chatty stderr can never fill its pipe and stall ffmpeg.
    let stderr_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });
    let mut parser = ProgressParser::default();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(progress) = parser.feed(&line) {
            on_progress(progress);
        }
    }
    let status = child.lock().unwrap().wait()?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        let detail = stderr_tail(&stderr);
        Err(AppError::ffmpeg(if detail.is_empty() { format!("ffmpeg exited with {status}") } else { detail }))
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Progress {
    pub frame: u64,
    pub fps: f64,
    /// Output timestamp reached, in seconds.
    pub out_time: f64,
    pub done: bool,
}

#[derive(Debug, Default)]
pub struct ProgressParser {
    frame: u64,
    fps: f64,
    out_time_us: i64,
}

impl ProgressParser {
    /// Feeds one line; returns a snapshot at the end of each block.
    pub fn feed(&mut self, line: &str) -> Option<Progress> {
        let (key, value) = line.trim().split_once('=')?;
        let value = value.trim();
        match key {
            "frame" => self.frame = value.parse().unwrap_or(self.frame),
            "fps" => self.fps = value.parse().unwrap_or(self.fps),
            // "N/A" until the first frame is written.
            "out_time_us" => self.out_time_us = value.parse().unwrap_or(self.out_time_us),
            "progress" => {
                return Some(Progress {
                    frame: self.frame,
                    fps: self.fps,
                    out_time: self.out_time_us.max(0) as f64 / 1e6,
                    done: value == "end",
                })
            }
            _ => {}
        }
        None
    }
}

/// Fraction complete in 0..=1 given the expected output duration.
pub fn fraction(out_time: f64, total: f64) -> f64 {
    if total <= 0.0 {
        return 0.0;
    }
    (out_time / total).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "frame=0\nfps=0.00\nstream_0_0_q=0.0\nbitrate=N/A\ntotal_size=48\nout_time_us=N/A\nout_time_ms=N/A\nout_time=N/A\ndup_frames=0\ndrop_frames=0\nspeed=N/A\nprogress=continue\n\
frame=45\nfps=44.10\nstream_0_0_q=28.0\nbitrate= 102.4kbits/s\ntotal_size=19265\nout_time_us=1500000\nout_time_ms=1500000\nout_time=00:00:01.500000\ndup_frames=0\ndrop_frames=0\nspeed=1.47x\nprogress=continue\n\
frame=60\nfps=45.00\nout_time_us=2000000\nprogress=end\n";

    #[test]
    fn parses_blocks() {
        let mut parser = ProgressParser::default();
        let snapshots: Vec<Progress> = SAMPLE.lines().filter_map(|l| parser.feed(l)).collect();
        assert_eq!(snapshots.len(), 3);
        assert_eq!(snapshots[0], Progress { frame: 0, fps: 0.0, out_time: 0.0, done: false });
        assert_eq!(snapshots[1], Progress { frame: 45, fps: 44.1, out_time: 1.5, done: false });
        assert!(snapshots[2].done);
        assert_eq!(fraction(snapshots[1].out_time, 3.0), 0.5);
        assert_eq!(fraction(5.0, 3.0), 1.0);
    }
}
