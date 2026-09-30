// Builds the render job sent to Rust (§6.6) from the EDL. Pure.
import { segmentTimes, type VideoProject } from './edl';

export interface RenderOptions {
  outPath: string;
  format: 'mp4-h264' | 'mp4-hevc' | 'mov' | 'webm';
  quality: 'low' | 'medium' | 'high';
  width: number;
  height: number;
  fps: number;
  audio: boolean;
}

export function buildRenderJob(p: VideoProject, o: RenderOptions) {
  const inputIndex = new Map<string, number>();
  const inputs: { path: string; hasAudio: boolean }[] = [];
  const segments = p.sequence.map((seg) => {
    const clip = p.clips[seg.clipId];
    let idx = inputIndex.get(clip.id);
    if (idx === undefined) {
      idx = inputs.length;
      inputIndex.set(clip.id, idx);
      // export always reads the ORIGINAL file, never the proxy (§2)
      inputs.push({ path: clip.path, hasAudio: clip.hasAudio });
    }
    const t = segmentTimes(clip, seg);
    return { input: idx, start: round6(t.start), end: round6(t.end) };
  });
  return { ...o, width: even(o.width), height: even(o.height), inputs, segments };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** yuv420p needs even dimensions. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export const RESOLUTIONS = {
  source: null,
  '1080p': 1080,
  '720p': 720,
} as const;

/** Scales output dims to a target height, keeping aspect. */
export function scaledDims(w: number, h: number, targetH: number | null): { width: number; height: number } {
  if (!targetH || targetH >= h) return { width: even(w), height: even(h) };
  return { width: even((w * targetH) / h), height: even(targetH) };
}
