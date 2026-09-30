import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { History, type Command } from '../model/commands/history';
import {
  appendClip,
  copyRange,
  deleteRange,
  duplicateSegment,
  moveSegment,
  pasteAt,
  removeSegment,
  sanitizeMarkers,
  seqLength,
  splitAt,
  trimSegment,
  trimToRange,
  type Clip,
  type Segment,
  type VideoProject,
} from '../model/edl';
import { formatDuration } from '../model/timecode';
import { ui } from './ui';

export function newProject(): VideoProject {
  return {
    id: nanoid(),
    version: 1,
    clips: {},
    sequence: [],
    markers: {},
    playhead: 0,
    output: { fps: 30, width: 1920, height: 1080 },
  };
}

interface VideoState {
  project: VideoProject | null;
  /** Sequence frame shown on stage. Not part of undo history. */
  playhead: number;
  playing: boolean;
  /** Timeline zoom in px per frame; 0 = fit the whole sequence. */
  pxPerFrame: number;
  /** Preview audio from the active clip (muted while scrubbing). */
  audio: boolean;
  timelineHeight: number;
  proxyProgress: Record<string, number>;
  lastRenderPath: string | null;
  savedProject: VideoProject | null;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;

  open(p: VideoProject): void;
  close(): void;
  exec(
    name: string,
    f: (p: VideoProject) => Partial<VideoProject>,
    opts?: { coalesceKey?: string; toast?: string },
  ): void;
  undo(): void;
  redo(): void;
  seal(): void;
  setPlayhead(f: number): void;
  setClip(clip: Clip): void;
  set(p: Partial<VideoState>): void;
}

const history = new History<VideoProject | null>(null);

export const useVideo = create<VideoState>((set, get) => {
  const sync = (extra: Partial<VideoState> = {}) => {
    const p = history.state;
    const len = p ? seqLength(p.sequence) : 0;
    const playhead = Math.max(0, Math.min(Math.max(0, len - 1), extra.playhead ?? get().playhead));
    set((s) => ({
      project: p,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      revision: s.revision + 1,
      ...extra,
      playhead,
    }));
  };
  return {
    project: null,
    playhead: 0,
    playing: false,
    pxPerFrame: 0,
    audio: true,
    timelineHeight: 132,
    proxyProgress: {},
    lastRenderPath: null,
    savedProject: null,
    revision: 0,
    canUndo: false,
    canRedo: false,

    open(p) {
      history.reset(p);
      sync({ playhead: p.playhead, savedProject: p, lastRenderPath: null, playing: false });
    },
    close() {
      history.reset(null);
      sync({ playhead: 0, savedProject: null, playing: false });
    },
    exec(name, f, opts = {}) {
      if (!history.state) return;
      const cmd: Command<VideoProject | null> = {
        name,
        coalesceKey: opts.coalesceKey,
        apply: (d) => {
          if (!d) return;
          const patch = f(d as VideoProject);
          Object.assign(d, patch);
          d.markers = sanitizeMarkers(d.markers, seqLength(d.sequence));
        },
      };
      history.execute(cmd);
      sync();
      if (opts.toast) ui().toast(opts.toast, { action: { label: 'Undo', run: () => get().undo() } });
    },
    undo() {
      history.undo();
      sync();
    },
    redo() {
      history.redo();
      sync();
    },
    seal() {
      history.seal();
    },
    setPlayhead(f) {
      const p = get().project;
      if (!p) return;
      const len = seqLength(p.sequence);
      set({ playhead: Math.max(0, Math.min(Math.max(0, len - 1), Math.round(f))) });
    },
    setClip(clip) {
      // Clip metadata updates (proxy/thumbnail) are not undoable edits.
      const p = history.state;
      if (!p) return;
      history.state = { ...p, clips: { ...p.clips, [clip.id]: clip } };
      sync();
    },
    set: (p) => set(p),
  };
});

export const video = () => useVideo.getState();

// ---- EDL operations as undoable commands (§6.2) -------------------------------------------------

const fps = () => video().project?.output.fps ?? 30;
const markedRange = (): [number, number] | null => {
  const m = video().project?.markers;
  if (!m || m.in === undefined || m.out === undefined || m.out <= m.in) return null;
  return [m.in, m.out];
};

export const edl = {
  hasRange: () => markedRange() !== null,
  setIn() {
    const f = video().playhead;
    video().exec('Set In', (p) => ({
      markers: {
        ...p.markers,
        in: f,
        out: p.markers.out !== undefined && p.markers.out <= f ? undefined : p.markers.out,
      },
    }));
  },
  setOut() {
    const f = video().playhead + 1; // out is exclusive: include the frame under the playhead
    video().exec('Set Out', (p) => ({
      markers: {
        ...p.markers,
        out: f,
        in: p.markers.in !== undefined && p.markers.in >= f ? undefined : p.markers.in,
      },
    }));
  },
  clearMarkers() {
    video().exec('Clear In/Out', () => ({ markers: {} }));
  },
  setMarkers(inF: number | undefined, outF: number | undefined, coalesceKey?: string) {
    video().exec('Move marker', () => ({ markers: { in: inF, out: outF } }), { coalesceKey });
  },
  deleteRange() {
    const r = markedRange();
    if (!r) return;
    video().exec('Delete segment', (p) => ({ sequence: deleteRange(p.sequence, r[0], r[1]), markers: {} }), {
      toast: `Deleted ${formatDuration(r[1] - r[0], fps())}`,
    });
    video().setPlayhead(r[0]);
  },
  trimToRange() {
    const r = markedRange();
    if (!r) return;
    video().exec('Trim to segment', (p) => ({ sequence: trimToRange(p.sequence, r[0], r[1]), markers: {} }), {
      toast: `Trimmed to ${formatDuration(r[1] - r[0], fps())}`,
    });
    video().setPlayhead(0);
  },
  copy() {
    const r = markedRange();
    if (!r) return;
    video().exec('Copy', (p) => ({ clipboard: copyRange(p.sequence, r[0], r[1]) }));
    ui().toast(`Copied ${formatDuration(r[1] - r[0], fps())}`);
  },
  cut() {
    const r = markedRange();
    if (!r) return;
    video().exec(
      'Cut',
      (p) => ({
        clipboard: copyRange(p.sequence, r[0], r[1]),
        sequence: deleteRange(p.sequence, r[0], r[1]),
        markers: {},
      }),
      { toast: `Cut ${formatDuration(r[1] - r[0], fps())}` },
    );
    video().setPlayhead(r[0]);
  },
  paste() {
    const clip = video().project?.clipboard;
    if (!clip?.length) return;
    const at = video().playhead;
    video().exec(
      'Paste',
      (p) => {
        const r = pasteAt(p.sequence, at, clip);
        return { sequence: r.seq, markers: { in: r.range[0], out: r.range[1] } };
      },
      {
        toast: `Pasted ${formatDuration(
          clip.reduce((n, s) => n + s.end - s.start, 0),
          fps(),
        )}`,
      },
    );
  },
  split() {
    const at = video().playhead;
    video().exec('Split', (p) => ({ sequence: splitAt(p.sequence, at) }));
  },
  move(from: number, to: number) {
    video().exec('Move clip', (p) => ({ sequence: moveSegment(p.sequence, from, to) }));
  },
  remove(idx: number) {
    video().exec('Remove clip', (p) => ({ sequence: removeSegment(p.sequence, idx) }), {
      toast: 'Removed clip',
    });
  },
  duplicate(idx: number) {
    video().exec('Duplicate clip', (p) => ({ sequence: duplicateSegment(p.sequence, idx) }));
  },
  trim(idx: number, edge: 'start' | 'end', clipFrame: number, coalesceKey: string) {
    video().exec(
      'Trim clip',
      (p) => {
        const seg = p.sequence[idx];
        const clip = p.clips[seg.clipId];
        return { sequence: trimSegment(p.sequence, idx, edge, clipFrame, clip.frames.length) };
      },
      { coalesceKey },
    );
  },
  appendClips(clips: Clip[]) {
    video().exec(clips.length > 1 ? `Add ${clips.length} clips` : 'Add clip', (p) => {
      let sequence: Segment[] = p.sequence;
      const all = { ...p.clips };
      for (const c of clips) {
        all[c.id] = c;
        sequence = appendClip(sequence, c);
      }
      const first = p.sequence.length === 0 ? clips[0] : null;
      return {
        clips: all,
        sequence,
        output: first ? { fps: first.fps, width: first.width, height: first.height } : p.output,
      };
    });
  },
};
