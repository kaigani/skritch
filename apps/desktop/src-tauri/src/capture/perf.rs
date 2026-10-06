//! Opt-in capture latency log: run with `SKRITCH_PERF=1` to print a timeline from the moment a
//! capture starts to each stage (and the overlay's first paint) on stderr.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

static ENABLED: OnceLock<bool> = OnceLock::new();
static T0: Mutex<Option<Instant>> = Mutex::new(None);

pub fn enabled() -> bool {
    *ENABLED.get_or_init(|| std::env::var_os("SKRITCH_PERF").is_some())
}

/// Starts a new timeline.
pub fn begin() {
    if enabled() {
        *T0.lock().unwrap() = Some(Instant::now());
        eprintln!("[skritch][perf] +    0.0 ms  capture_start");
    }
}

/// Logs `label` with the time since [`begin`].
pub fn mark(label: &str) {
    if !enabled() {
        return;
    }
    if let Some(t0) = *T0.lock().unwrap() {
        eprintln!("[skritch][perf] + {:>6.1} ms  {label}", t0.elapsed().as_secs_f64() * 1000.0);
    }
}
