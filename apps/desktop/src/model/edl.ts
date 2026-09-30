// Non-destructive Edit Decision List (§6.2). Pure; every operation returns a new sequence.
import { nanoid } from 'nanoid';
import type { Id } from './types';

export interface Clip {
  id: Id;
  path: string;
  proxyPath?: string;
  /** URL the <video> element plays (asset:// in Tauri, blob: in the browser dev build). */
  playUrl?: string;
  displayName: string;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  codec: string;
  hasAudio: boolean;
  /** pts_time of every video frame, ascending (§6.3). */
  frames: Float64Array;
  proxyFrames?: Float64Array;
  rotation: 0 | 90 | 180 | 270;
  thumbnail?: string;
}

/** Clip frame indices, half-open [start, end). */
export interface Segment {
  id: Id;
  clipId: Id;
  start: number;
  end: number;
}

export interface Markers {
  in?: number;
  out?: number;
}

export interface VideoProject {
  id: Id;
  version: 1;
  clips: Record<Id, Clip>;
  sequence: Segment[];
  /** Sequence frame indices, half-open [in, out). */
  markers: Markers;
  playhead: number;
  output: { fps: number; width: number; height: number };
  clipboard?: Segment[];
}

export const segId = (): Id => nanoid(8);
export const segLen = (s: Segment): number => s.end - s.start;

export function seqLength(seq: Segment[]): number {
  let n = 0;
  for (const s of seq) n += s.end - s.start;
  return n;
}

/** Prefix sums: starts[i] = sequence frame where segment i begins. */
export function segmentStarts(seq: Segment[]): number[] {
  const out: number[] = new Array(seq.length);
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    out[i] = acc;
    acc += seq[i].end - seq[i].start;
  }
  return out;
}

export interface Located {
  segIdx: number;
  seg: Segment;
  clipFrame: number;
  segStart: number;
}

/** Maps a sequence frame to its segment and clip frame (binary search over prefix sums). */
export function locate(seq: Segment[], seqFrame: number, starts = segmentStarts(seq)): Located | null {
  const total = seqLength(seq);
  if (seq.length === 0 || seqFrame < 0 || seqFrame >= total) return null;
  let lo = 0;
  let hi = seq.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= seqFrame) lo = mid;
    else hi = mid - 1;
  }
  // skip zero-length segments (should not exist, but be robust)
  while (lo < seq.length - 1 && segLen(seq[lo]) === 0) lo++;
  const seg = seq[lo];
  return { segIdx: lo, seg, clipFrame: seg.start + (seqFrame - starts[lo]), segStart: starts[lo] };
}

/** Splits the segment containing `seqFrame`; no-op at boundaries. */
export function splitAt(seq: Segment[], seqFrame: number): Segment[] {
  const loc = locate(seq, seqFrame);
  if (!loc || loc.clipFrame === loc.seg.start) return seq;
  const { segIdx, seg, clipFrame } = loc;
  const a: Segment = { ...seg, end: clipFrame };
  const b: Segment = { ...seg, id: segId(), start: clipFrame };
  return [...seq.slice(0, segIdx), a, b, ...seq.slice(segIdx + 1)];
}

/** Splits at both points and returns [sequence, firstIdx, endIdx) covering [inF, outF). */
function splitRange(seq: Segment[], inF: number, outF: number): { seq: Segment[]; i0: number; i1: number } {
  let s = splitAt(seq, inF);
  s = splitAt(s, outF);
  const starts = segmentStarts(s);
  let i0 = starts.findIndex((st) => st >= inF);
  if (i0 < 0) i0 = s.length;
  let i1 = starts.findIndex((st) => st >= outF);
  if (i1 < 0) i1 = s.length;
  return { seq: s, i0, i1 };
}

const clampRange = (seq: Segment[], a: number, b: number): [number, number] => {
  const n = seqLength(seq);
  const inF = Math.max(0, Math.min(n, Math.min(a, b)));
  const outF = Math.max(0, Math.min(n, Math.max(a, b)));
  return [inF, outF];
};

/** 3C: remove [in, out). */
export function deleteRange(seq: Segment[], a: number, b: number): Segment[] {
  const [inF, outF] = clampRange(seq, a, b);
  if (outF <= inF) return seq;
  const { seq: s, i0, i1 } = splitRange(seq, inF, outF);
  return [...s.slice(0, i0), ...s.slice(i1)];
}

/** 3D: keep only [in, out). */
export function trimToRange(seq: Segment[], a: number, b: number): Segment[] {
  const [inF, outF] = clampRange(seq, a, b);
  if (outF <= inF) return seq;
  const { seq: s, i0, i1 } = splitRange(seq, inF, outF);
  return s.slice(i0, i1);
}

/** 3E: deep copy of the segments covering [in, out). */
export function copyRange(seq: Segment[], a: number, b: number): Segment[] {
  const [inF, outF] = clampRange(seq, a, b);
  if (outF <= inF) return [];
  const { seq: s, i0, i1 } = splitRange(seq, inF, outF);
  return s.slice(i0, i1).map((x) => ({ ...x }));
}

/** 3E: insert clones (new ids) at seqFrame. Returns the new sequence and the pasted range. */
export function pasteAt(
  seq: Segment[],
  seqFrame: number,
  clip: Segment[],
): { seq: Segment[]; range: [number, number] } {
  const at = Math.max(0, Math.min(seqLength(seq), seqFrame));
  const s = splitAt(seq, at);
  const starts = segmentStarts(s);
  let idx = starts.findIndex((st) => st >= at);
  if (idx < 0) idx = s.length;
  const clones = clip.map((c) => ({ ...c, id: segId() }));
  return { seq: [...s.slice(0, idx), ...clones, ...s.slice(idx)], range: [at, at + seqLength(clones)] };
}

/** 3A: rearrange by dragging. `toIdx` is the insertion index in the original array (0..n). */
export function moveSegment(seq: Segment[], fromIdx: number, toIdx: number): Segment[] {
  if (fromIdx < 0 || fromIdx >= seq.length) return seq;
  const target = toIdx > fromIdx ? toIdx - 1 : toIdx;
  if (target === fromIdx) return seq;
  const s = seq.slice();
  const [m] = s.splice(fromIdx, 1);
  s.splice(Math.max(0, Math.min(s.length, target)), 0, m);
  return s;
}

export const removeSegment = (seq: Segment[], idx: number): Segment[] => seq.filter((_, i) => i !== idx);

export function duplicateSegment(seq: Segment[], idx: number): Segment[] {
  if (idx < 0 || idx >= seq.length) return seq;
  return [...seq.slice(0, idx + 1), { ...seq[idx], id: segId() }, ...seq.slice(idx + 1)];
}

export function appendClip(seq: Segment[], clip: Pick<Clip, 'id' | 'frames'>): Segment[] {
  return [...seq, { id: segId(), clipId: clip.id, start: 0, end: clip.frames.length }];
}

/** Adjusts a segment's trim, clamped to the clip and keeping at least one frame. */
export function trimSegment(
  seq: Segment[],
  idx: number,
  edge: 'start' | 'end',
  clipFrame: number,
  clipFrames: number,
): Segment[] {
  const s = seq[idx];
  if (!s) return seq;
  const next =
    edge === 'start'
      ? { ...s, start: Math.max(0, Math.min(s.end - 1, Math.round(clipFrame))) }
      : { ...s, end: Math.min(clipFrames, Math.max(s.start + 1, Math.round(clipFrame))) };
  return seq.map((x, i) => (i === idx ? next : x));
}

/** Markers are always in sequence frames and are clamped/cleared when an edit makes them invalid. */
export function sanitizeMarkers(m: Markers, length: number): Markers {
  const out: Markers = {};
  if (m.in !== undefined && m.in >= 0 && m.in < length) out.in = m.in;
  if (m.out !== undefined && m.out > 0) out.out = Math.min(m.out, length);
  if (out.in !== undefined && out.out !== undefined && out.out <= out.in) delete out.out;
  return out;
}

/** Expands a sequence to a flat list of [clipId, clipFrame] — the naive oracle used by tests. */
export function expand(seq: Segment[]): Array<[Id, number]> {
  const out: Array<[Id, number]> = [];
  for (const s of seq) for (let f = s.start; f < s.end; f++) out.push([s.clipId, f]);
  return out;
}

/** Frame index lookup: binary search for the frame whose pts is the last ≤ t. */
export function frameAtTime(frames: Float64Array, t: number): number {
  if (frames.length === 0) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  if (t <= frames[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid] <= t + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** §6.3 seek target for frame n: pts + min(frameDuration/2, 0.002). */
export function seekTime(frames: Float64Array, n: number, fps: number): number {
  const i = Math.max(0, Math.min(frames.length - 1, n));
  const dur = i + 1 < frames.length ? frames[i + 1] - frames[i] : 1 / fps;
  return frames[i] + Math.min(dur / 2, 0.002);
}

/** Segment start/end seconds for rendering, from the ORIGINAL clip's frame index (§6.6). */
export function segmentTimes(
  clip: Pick<Clip, 'frames' | 'durationSec'>,
  seg: Segment,
): { start: number; end: number } {
  const start = clip.frames[seg.start] ?? 0;
  const end = seg.end < clip.frames.length ? clip.frames[seg.end] : clip.durationSec;
  return { start, end };
}

/** Synthetic evenly spaced frame index (used when only fps/duration are known). */
export function syntheticFrames(fps: number, count: number, offset = 0): Float64Array {
  const f = new Float64Array(count);
  for (let i = 0; i < count; i++) f[i] = offset + i / fps;
  return f;
}
