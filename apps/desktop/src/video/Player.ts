// Multi-<video> playback engine (§6.4). One hidden <video> per clip (max 8 mounted, LRU), exact frame
// seeks via the frame index (§6.3), frames drawn into the stage canvas letterboxed to the output size.
import {
  frameAtTime,
  locate,
  segmentStarts,
  seekTime,
  seqLength,
  type Clip,
  type VideoProject,
} from '../model/edl';
import { useVideo, video } from '../state/video';

const MAX_MOUNTED = 8;
type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;

export class Player {
  private els = new Map<string, HTMLVideoElement>();
  private lru: string[] = [];
  private host: HTMLDivElement;
  private seeking = false;
  private pendingFrame: number | null = null;
  private playing: { clipId: string; segIdx: number } | null = null;
  private lastDrawn: { el: HTMLVideoElement; clip: Clip } | null = null;
  private unsub: () => void;
  private canvas: HTMLCanvasElement | null = null;
  /** Letterbox rect of the output frame inside the stage (CSS px), for overlays. */
  frameRect = { x: 0, y: 0, w: 0, h: 0 };

  constructor() {
    this.host = document.createElement('div');
    this.host.style.cssText =
      'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-10px;top:-10px';
    document.body.appendChild(this.host);
    this.unsub = useVideo.subscribe((s, prev) => {
      if (s.project !== prev.project && !this.playing) this.show(s.playhead);
      else if (s.playhead !== prev.playhead && !this.playing) this.show(s.playhead);
      if (s.playing !== prev.playing) {
        if (s.playing) this.play();
        else this.pause();
      }
    });
  }

  destroy(): void {
    this.pause();
    this.unsub();
    this.host.remove();
    this.els.clear();
  }

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.redraw();
  }

  private element(clip: Clip): HTMLVideoElement | null {
    if (!clip.playUrl) return null;
    let el = this.els.get(clip.id);
    if (!el || el.dataset.src !== clip.playUrl) {
      el?.remove();
      el = document.createElement('video');
      el.preload = 'auto';
      el.muted = true;
      el.playsInline = true;
      el.crossOrigin = 'anonymous';
      el.src = clip.playUrl;
      el.dataset.src = clip.playUrl;
      this.host.appendChild(el);
      this.els.set(clip.id, el);
    }
    this.lru = [clip.id, ...this.lru.filter((id) => id !== clip.id)];
    for (const id of this.lru.slice(MAX_MOUNTED)) {
      this.els.get(id)?.remove();
      this.els.delete(id);
    }
    this.lru = this.lru.slice(0, MAX_MOUNTED);
    return el;
  }

  private displayFrames(clip: Clip): Float64Array {
    return clip.proxyPath && clip.proxyFrames ? clip.proxyFrames : clip.frames;
  }

  /** Seeks to a sequence frame and draws it. At most one seek is in flight; the latest target wins. */
  show(seqFrame: number): void {
    this.pendingFrame = seqFrame;
    if (!this.seeking) void this.drainSeeks();
  }

  private async drainSeeks(): Promise<void> {
    this.seeking = true;
    try {
      while (this.pendingFrame !== null) {
        const f = this.pendingFrame;
        this.pendingFrame = null;
        await this.seekAndDraw(f);
      }
    } finally {
      this.seeking = false;
    }
  }

  private async seekAndDraw(seqFrame: number): Promise<void> {
    const p = video().project;
    if (!p) return this.clear();
    const loc = locate(p.sequence, seqFrame);
    if (!loc) return this.clear();
    const clip = p.clips[loc.seg.clipId];
    const el = this.element(clip);
    if (!el) return this.clear(clip);
    await ready(el);
    const frames = this.displayFrames(clip);
    const target = seekTime(frames, loc.clipFrame, clip.fps);
    if (Math.abs(el.currentTime - target) > 1e-4) {
      await new Promise<void>((resolve) => {
        const done = () => {
          el.removeEventListener('seeked', done);
          resolve();
        };
        el.addEventListener('seeked', done);
        el.currentTime = target;
        setTimeout(done, 1500);
      });
      await presented(el);
    }
    this.lastDrawn = { el, clip };
    this.redraw();
  }

  private clear(clip?: Clip): void {
    this.lastDrawn = null;
    this.redraw(clip ? `Preparing ${clip.displayName}…` : undefined);
  }

  /** Redraws the last presented frame (also used on stage resize). */
  redraw(message?: string): void {
    const c = this.canvas;
    const p = video().project;
    if (!c || !p) return;
    const g = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.width / dpr;
    const cssH = c.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#a3a3a3';
    g.fillRect(0, 0, cssW, cssH);
    const { width: ow, height: oh } = p.output;
    const k = Math.min((cssW - 48) / ow, (cssH - 48) / oh, 4);
    const fw = Math.round(ow * k);
    const fh = Math.round(oh * k);
    const fx = Math.round((cssW - fw) / 2);
    const fy = Math.round((cssH - fh) / 2);
    this.frameRect = { x: fx, y: fy, w: fw, h: fh };
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 4;
    g.fillStyle = '#000';
    g.fillRect(fx, fy, fw, fh);
    g.restore();
    const d = this.lastDrawn;
    if (d && d.el.videoWidth) {
      // segments whose clip dimensions differ from the output are fitted with black bars, as export does
      const s = Math.min(fw / d.el.videoWidth, fh / d.el.videoHeight);
      const w = d.el.videoWidth * s;
      const h = d.el.videoHeight * s;
      g.imageSmoothingQuality = 'high';
      g.drawImage(d.el, fx + (fw - w) / 2, fy + (fh - h) / 2, w, h);
    } else if (message) {
      g.fillStyle = '#ddd';
      g.font = '500 14px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(message, fx + fw / 2, fy + fh / 2);
    }
  }

  // ---------------------------------------------------------------- playback
  private play(): void {
    const { project: p, playhead } = video();
    if (!p || !p.sequence.length) return useVideo.setState({ playing: false });
    const start = playhead >= seqLength(p.sequence) - 1 ? 0 : playhead;
    const loc = locate(p.sequence, start);
    if (!loc) return useVideo.setState({ playing: false });
    void this.playSegment(p, loc.segIdx, loc.clipFrame);
  }

  private async playSegment(p: VideoProject, segIdx: number, clipFrame: number): Promise<void> {
    const seg = p.sequence[segIdx];
    const clip = p.clips[seg.clipId];
    const el = this.element(clip);
    if (!el) return useVideo.setState({ playing: false });
    this.playing = { clipId: clip.id, segIdx };
    await ready(el);
    const frames = this.displayFrames(clip);
    el.currentTime = seekTime(frames, clipFrame, clip.fps);
    el.muted = !video().audio;
    try {
      await el.play();
    } catch {
      return useVideo.setState({ playing: false });
    }
    const starts = segmentStarts(p.sequence);
    const tick: Parameters<RVFC>[0] = (_now, meta) => {
      if (!this.playing || this.playing.segIdx !== segIdx || video().project !== p) return;
      const cf = frameAtTime(frames, meta.mediaTime);
      this.lastDrawn = { el, clip };
      this.redraw();
      if (cf >= seg.end - 1 || el.ended) {
        el.pause();
        const next = segIdx + 1;
        video().setPlayhead(starts[segIdx] + (seg.end - seg.start) - 1);
        if (next < p.sequence.length) void this.playSegment(p, next, p.sequence[next].start);
        else {
          this.playing = null;
          useVideo.setState({ playing: false });
        }
        return;
      }
      video().setPlayhead(starts[segIdx] + Math.max(0, cf - seg.start));
      (el as unknown as { requestVideoFrameCallback: RVFC }).requestVideoFrameCallback(tick);
    };
    (el as unknown as { requestVideoFrameCallback: RVFC }).requestVideoFrameCallback(tick);
  }

  private pause(): void {
    if (!this.playing) return;
    this.els.get(this.playing.clipId)?.pause();
    this.playing = null;
    this.show(video().playhead);
  }
}

function ready(el: HTMLVideoElement): Promise<void> {
  if (el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('loadeddata', done);
      el.removeEventListener('error', done);
      resolve();
    };
    el.addEventListener('loadeddata', done);
    el.addEventListener('error', done);
  });
}

/** Resolves once the seeked frame is actually presented (requestVideoFrameCallback), with a timeout. */
function presented(el: HTMLVideoElement): Promise<void> {
  const rvfc = (el as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback;
  if (!rvfc) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 120);
    rvfc.call(el, () => {
      clearTimeout(t);
      resolve();
    });
  });
}

export let player: Player | null = null;
export const setPlayer = (p: Player | null) => {
  player = p;
};
