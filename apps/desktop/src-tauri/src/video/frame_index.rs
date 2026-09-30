//! Frame index: presentation timestamps of every video frame, ascending (plan §6.3).
//!
//! Built from a packet listing (no decode). Packets arrive in decode order, so with B-frames the
//! pts are out of order: sort, drop packets without pts or flagged discard, dedupe.

use std::path::Path;
use std::time::UNIX_EPOCH;

use base64::Engine;

use crate::error::AppResult;

/// Timestamps closer than this are the same frame (ffprobe prints 6 decimals).
const SAME_FRAME: f64 = 1e-7;

/// Parses `ffprobe -show_entries packet=pts_time,flags -of csv=p=0` output. Timestamps are
/// shifted by `-start_time` so they match ffmpeg's default input timeline (what `-ss` and `trim`
/// use) and the `<video>` element's `currentTime`.
pub fn parse_packet_csv(csv: &str, start_time: f64) -> Vec<f64> {
    let mut frames: Vec<f64> = csv
        .lines()
        .filter_map(|line| {
            let mut fields = line.trim().split(',');
            let pts: f64 = fields.next()?.parse().ok()?; // "N/A" (no pts) fails here
            let flags = fields.next().unwrap_or("");
            // 'D' = discard (e.g. pre-roll before an edit list start): never presented.
            (!flags.contains('D')).then_some(pts - start_time)
        })
        .filter(|t| t.is_finite())
        .collect();
    frames.sort_by(f64::total_cmp);
    frames.dedup_by(|a, b| (*a - *b).abs() < SAME_FRAME);
    frames
}

/// Little-endian f64 array, base64 (`ClipInfo.framesB64`, decoded into a `Float64Array` in JS).
pub fn to_base64(frames: &[f64]) -> String {
    base64::engine::general_purpose::STANDARD.encode(to_bytes(frames))
}

fn to_bytes(frames: &[f64]) -> Vec<u8> {
    frames.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn from_bytes(bytes: &[u8]) -> Option<Vec<f64>> {
    (bytes.len() % 8 == 0).then(|| bytes.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect())
}

/// Cache key for a media file: FNV-1a of path + size + mtime. Stable across runs and Rust versions.
pub fn cache_key(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let input = [path.to_string_lossy().as_bytes(), &meta.len().to_le_bytes(), &mtime.to_le_bytes()].concat();
    for byte in input {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    Some(format!("{hash:016x}"))
}

/// Runs the packet listing (or reads `<cache_dir>/<key>.frames.bin`).
pub fn index(path: &Path, start_time: f64, cache_dir: Option<&Path>) -> AppResult<Vec<f64>> {
    let cache_file = cache_dir.zip(cache_key(path)).map(|(dir, key)| dir.join(format!("{key}.frames.bin")));
    if let Some(frames) = cache_file.as_ref().and_then(|f| std::fs::read(f).ok()).and_then(|b| from_bytes(&b)) {
        return Ok(frames);
    }
    let args = ["-v", "error", "-select_streams", "V:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0"]
        .iter()
        .map(|s| s.to_string())
        .chain([path.to_string_lossy().into_owned()])
        .collect::<Vec<_>>();
    let csv = super::run_capture("ffprobe", &args)?;
    let frames = parse_packet_csv(&String::from_utf8_lossy(&csv), start_time);
    if let Some(file) = cache_file {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, to_bytes(&frames));
    }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_bframe_packets_into_presentation_order() {
        let frames = parse_packet_csv(include_str!("fixtures/bframes.csv"), 0.0);
        assert_eq!(frames.len(), 30);
        assert!(frames.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(frames[0], 0.0);
        assert_eq!(frames[1], 0.033333);
        assert_eq!(frames[29], 0.966667);
    }

    #[test]
    fn ntsc_rate_index_is_evenly_spaced() {
        let frames = parse_packet_csv(include_str!("fixtures/ntsc.csv"), 0.0);
        assert_eq!(frames.len(), 15);
        let step = 1001.0 / 30000.0;
        for (i, t) in frames.iter().enumerate() {
            assert!((t - i as f64 * step).abs() < 1e-6, "frame {i}: {t}");
        }
    }

    #[test]
    fn drops_missing_pts_discarded_packets_and_duplicates() {
        let csv = "0.066667,___\nN/A,___\n0.000000,K__\n-0.033333,K_D\n0.033333,___\n0.033333,___\n\n";
        assert_eq!(parse_packet_csv(csv, 0.0), vec![0.0, 0.033333, 0.066667]);
    }

    #[test]
    fn shifts_by_start_time() {
        let frames = parse_packet_csv("1.500000,K__\n1.540000,___\n", 1.5);
        assert!((frames[1] - 0.04).abs() < 1e-9 && frames[0] == 0.0);
    }

    #[test]
    fn base64_roundtrip_is_little_endian_f64() {
        let frames = [0.0, 0.5, 1.0 / 3.0];
        let bytes = base64::engine::general_purpose::STANDARD.decode(to_base64(&frames)).unwrap();
        assert_eq!(&bytes[8..16], &0.5f64.to_le_bytes());
        assert_eq!(from_bytes(&bytes).unwrap(), frames);
    }
}
