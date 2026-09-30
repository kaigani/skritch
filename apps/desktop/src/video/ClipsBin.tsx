import { appendClip } from '../model/edl';
import { formatDuration } from '../model/timecode';
import { useVideo, video } from '../state/video';

/** Clips bin (⌥⌘B): every imported clip, even ones with no segments left, can be re-added. */
export function ClipsBin() {
  const project = useVideo((s) => s.project);
  if (!project) return null;
  const clips = Object.values(project.clips);
  const used = new Set(project.sequence.map((s) => s.clipId));
  return (
    <div className="clipsbin">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Clips</div>
      {clips.map((c) => (
        <div className="item" key={c.id}>
          {c.thumbnail ? <img src={c.thumbnail} alt="" /> : <img alt="" />}
          <div className="meta">
            <div>{c.displayName}</div>
            <div>
              {c.width}×{c.height} · {Math.round(c.fps * 100) / 100} fps ·{' '}
              {formatDuration(c.frames.length, c.fps)}
              {used.has(c.id) ? '' : ' · unused'}
            </div>
          </div>
          <button
            className="pill"
            onClick={() => video().exec('Add to end', (p) => ({ sequence: appendClip(p.sequence, c) }))}
          >
            + Add to end
          </button>
        </div>
      ))}
    </div>
  );
}
