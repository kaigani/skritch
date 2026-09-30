/** HH:MM:SS:FF at the project fps (non-drop-frame). */
export function formatTimecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const r = Math.max(1, Math.round(fps));
  const ff = f % r;
  const totalSec = Math.floor(f / r);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Compact duration like Skitch's toast: "4s12" = 4 seconds 12 frames; "1m04s" beyond a minute. */
export function formatDuration(frames: number, fps: number): string {
  const r = Math.max(1, Math.round(fps));
  const totalSec = Math.floor(frames / r);
  const ff = frames % r;
  if (totalSec >= 60) {
    const m = Math.floor(totalSec / 60);
    return `${m}m${String(totalSec % 60).padStart(2, '0')}s`;
  }
  return `${totalSec}s${String(ff).padStart(2, '0')}`;
}
