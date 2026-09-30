import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { segmentStarts, seqLength } from '../model/edl';
import { formatDuration, formatTimecode } from '../model/timecode';
import { edl, useVideo, video } from '../state/video';
import { useUi } from '../state/ui';
import { Icon } from '../ui/icons';
import { Popover } from '../ui/Popover';
import { ClipsBin } from './ClipsBin';

const PAD = 12;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 150, 300, 600, 1800, 3600, 9000, 18000, 36000];

type Drag =
  | { kind: 'scrub' }
  | { kind: 'block'; idx: number; startX: number; dx: number; moving: boolean; drop: number }
  | { kind: 'trim'; idx: number; edge: 'start' | 'end'; startX: number; orig: number; key: string }
  | { kind: 'marker'; which: 'in' | 'out'; key: string };

/**
 * Timeline (§6.5): transport, ruler with timecode, clip blocks (drag to reorder, trim handles),
 * In/Out markers with a highlighted band, draggable playhead, ⌘-wheel zoom.
 */
export function Timeline() {
  const project = useVideo((s) => s.project)!;
  const playhead = useVideo((s) => s.playhead);
  const playing = useVideo((s) => s.playing);
  const pxPerFrame = useVideo((s) => s.pxPerFrame);
  const height = useVideo((s) => s.timelineHeight);
  const proxyProgress = useVideo((s) => s.proxyProgress);
  const tracks = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const binBtn = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(800);
  const [scroll, setScroll] = useState(0);
  // The ref is authoritative for event handling (pointer events can outrun React renders on a busy
  // machine); the state mirrors it for rendering.
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const popover = useUi((s) => s.popover);

  const { sequence, markers, output } = project;
  const fps = output.fps;
  const len = seqLength(sequence);
  const starts = segmentStarts(sequence);
  const fitPpf = Math.max(0.02, (width - PAD * 2) / Math.max(1, len));
  const ppf = pxPerFrame > 0 ? pxPerFrame : fitPpf;
  const innerW = Math.max(width, PAD * 2 + len * ppf);
  const X = (f: number) => PAD + f * ppf;

  useLayoutEffect(() => {
    const el = tracks.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameAt = (clientX: number) => {
    const el = tracks.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(len - 1, Math.floor((clientX - r.left + el.scrollLeft - PAD) / ppf)));
  };

  // keep the playhead visible during playback
  useEffect(() => {
    const el = tracks.current;
    if (!el || !playing) return;
    const px = X(playhead);
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = px - 40;
  });

  // ruler
  useEffect(() => {
    const c = ruler.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(22 * dpr);
    c.style.width = `${width}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, 22);
    const major = TICK_STEPS.find((s) => s * ppf >= 90) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const minor = ppf >= 6 ? 1 : Math.max(1, major / 5);
    const f0 = Math.max(0, Math.floor((scroll - PAD) / ppf));
    const f1 = Math.min(len, Math.ceil((scroll + width) / ppf));
    g.strokeStyle = '#777';
    g.fillStyle = '#bbb';
    g.font = '10px Inter, system-ui, sans-serif';
    g.beginPath();
    for (let f = Math.floor(f0 / minor) * minor; f <= f1; f += minor) {
      const x = Math.round(PAD + f * ppf - scroll) + 0.5;
      const isMajor = f % major === 0;
      g.moveTo(x, isMajor ? 8 : 15);
      g.lineTo(x, 22);
      if (isMajor) g.fillText(formatTimecode(f, fps), x + 3, 10);
    }
    g.stroke();
  }, [width, scroll, ppf, len, fps]);

  const onWheel = (e: React.WheelEvent) => {
    const el = tracks.current!;
    if (e.ctrlKey || e.metaKey) {
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const f = (cx + el.scrollLeft - PAD) / ppf;
      const next = Math.max(fitPpf, Math.min(40, ppf * Math.exp(-e.deltaY * 0.002)));
      video().set({ pxPerFrame: next <= fitPpf * 1.001 ? 0 : next });
      requestAnimationFrame(() => (el.scrollLeft = PAD + f * next - cx));
    } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  // ---- pointer interactions -----------------------------------------------------------------
  const onPointerDownTracks = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const t = e.target as HTMLElement;
    const blockEl = t.closest('[data-block]') as HTMLElement | null;
    const markerEl = t.closest('[data-marker]') as HTMLElement | null;
    useVideo.setState({ playing: false });
    if (markerEl) {
      updateDrag({
        kind: 'marker',
        which: markerEl.dataset.marker as 'in' | 'out',
        key: `marker:${Date.now()}`,
      });
      return;
    }
    if (t.dataset.trim && blockEl) {
      const idx = +blockEl.dataset.block!;
      const seg = sequence[idx];
      const edge = t.dataset.trim as 'start' | 'end';
      updateDrag({
        kind: 'trim',
        idx,
        edge,
        startX: e.clientX,
        orig: edge === 'start' ? seg.start : seg.end,
        key: `trim:${seg.id}:${Date.now()}`,
      });
      return;
    }
    if (blockEl && !t.closest('.ruler')) {
      updateDrag({
        kind: 'block',
        idx: +blockEl.dataset.block!,
        startX: e.clientX,
        dx: 0,
        moving: false,
        drop: -1,
      });
      return;
    }
    video().setPlayhead(frameAt(e.clientX));
    updateDrag({ kind: 'scrub' });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'scrub') video().setPlayhead(frameAt(e.clientX));
    else if (drag.kind === 'marker') {
      const f = frameAt(e.clientX);
      if (drag.which === 'in')
        edl.setMarkers(f, markers.out !== undefined && markers.out > f ? markers.out : undefined, drag.key);
      else
        edl.setMarkers(
          markers.in !== undefined && markers.in < f + 1 ? markers.in : undefined,
          f + 1,
          drag.key,
        );
    } else if (drag.kind === 'trim') {
      const delta = Math.round((e.clientX - drag.startX) / ppf);
      edl.trim(drag.idx, drag.edge, drag.orig + delta, drag.key);
    } else {
      const dx = e.clientX - drag.startX;
      const moving = drag.moving || Math.abs(dx) > 4;
      // drop index: before the first block whose midpoint is right of the pointer
      const f = frameAt(e.clientX);
      let drop = sequence.length;
      for (let i = 0; i < sequence.length; i++) {
        if (starts[i] + (sequence[i].end - sequence[i].start) / 2 > f) {
          drop = i;
          break;
        }
      }
      updateDrag({ ...drag, dx, moving, drop });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'block') {
      if (drag.moving) edl.move(drag.idx, drag.drop);
      else video().setPlayhead(frameAt(e.clientX));
    } else if (drag.kind === 'trim' || drag.kind === 'marker') video().seal();
    updateDrag(null);
  };

  // ---- transport ------------------------------------------------------------------------------
  const inTc = markers.in !== undefined ? formatTimecode(markers.in, fps) : '--:--:--:--';
  const outTc = markers.out !== undefined ? formatTimecode(markers.out, fps) : '--:--:--:--';
  const delta =
    markers.in !== undefined && markers.out !== undefined
      ? formatDuration(markers.out - markers.in, fps)
      : null;

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) =>
      video().set({ timelineHeight: Math.max(96, Math.min(240, h0 - (ev.clientY - y0))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="timeline" style={{ height }} aria-label="Timeline">
      <div className="resize" onPointerDown={startResize} />
      <div className="transport">
        <button title="Go to start (Home)" aria-label="Go to start" onClick={() => video().setPlayhead(0)}>
          <Icon.toStart />
        </button>
        <button
          title="Step back (←)"
          aria-label="Step back"
          onClick={() => video().setPlayhead(playhead - 1)}
        >
          <Icon.stepBack />
        </button>
        <button
          title="Play/Pause (Space)"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => useVideo.setState({ playing: !playing })}
        >
          {playing ? <Icon.pause /> : <Icon.play />}
        </button>
        <button
          title="Step forward (→)"
          aria-label="Step forward"
          onClick={() => video().setPlayhead(playhead + 1)}
        >
          <Icon.stepFwd />
        </button>
        <button title="Go to end (End)" aria-label="Go to end" onClick={() => video().setPlayhead(len - 1)}>
          <Icon.toEnd />
        </button>
        <span className="tc" data-testid="timecode">
          {formatTimecode(playhead, fps)}
        </span>
        <span className="dim" data-testid="frame-counter">
          frame {playhead} / {len}
        </span>
        <div className="marks">
          <span>
            In <b>{inTc}</b>
          </span>
          <span>
            Out <b>{outTc}</b>
          </span>
          {delta && <span className="delta">Δ {delta}</span>}
          <button
            ref={binBtn}
            title="Clips bin"
            aria-label="Clips bin"
            onClick={() => useUi.setState({ popover: popover === 'clips' ? null : 'clips' })}
          >
            <Icon.bin />
          </button>
        </div>
      </div>
      <div
        className="tracks"
        ref={tracks}
        onScroll={(e) => setScroll((e.target as HTMLElement).scrollLeft)}
        onWheel={onWheel}
        onPointerDown={onPointerDownTracks}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => updateDrag(null)}
        data-testid="tracks"
      >
        <div className="inner" style={{ width: innerW }}>
          <div className="ruler" style={{ width: innerW }}>
            <canvas ref={ruler} style={{ position: 'sticky', left: 0 }} />
          </div>
          {markers.in !== undefined && markers.out !== undefined && (
            <div
              className="markband"
              style={{ left: X(markers.in), width: (markers.out - markers.in) * ppf }}
            />
          )}
          {markers.in !== undefined && (
            <div className="marker" data-marker="in" title="In" style={{ left: X(markers.in) }}>
              [
            </div>
          )}
          {markers.out !== undefined && (
            <div className="marker" data-marker="out" title="Out" style={{ left: X(markers.out) }}>
              ]
            </div>
          )}
          <div className="blocks" style={{ width: innerW }}>
            {sequence.map((seg, i) => {
              const clip = project.clips[seg.clipId];
              const n = seg.end - seg.start;
              const dragging = drag?.kind === 'block' && drag.idx === i && drag.moving;
              const prog = proxyProgress[clip.id];
              return (
                <div
                  key={seg.id}
                  data-block={i}
                  className={`block ${Object.keys(project.clips).indexOf(clip.id) % 2 ? 'alt' : ''} ${dragging ? 'dragging' : ''}`}
                  style={{
                    left: X(starts[i]) + 1,
                    width: Math.max(4, n * ppf - 2),
                    transform: dragging ? `translateX(${drag.dx}px)` : undefined,
                  }}
                  title={`${clip.displayName} — frames ${seg.start}–${seg.end - 1} · ${formatDuration(n, fps)}`}
                >
                  {clip.thumbnail && (
                    <div className="thumbs" style={{ backgroundImage: `url(${clip.thumbnail})` }} />
                  )}
                  <div className="label">
                    {clip.displayName}
                    <span className="dur">{formatDuration(n, fps)}</span>
                  </div>
                  {prog !== undefined && (
                    <div className="proxy progress" title="Preparing preview">
                      <i style={{ width: `${Math.round(prog * 100)}%` }} />
                    </div>
                  )}
                  <div className="trim l" data-trim="start" title={`Trim start (clip frame ${seg.start})`} />
                  <div className="trim r" data-trim="end" title={`Trim end (clip frame ${seg.end})`} />
                </div>
              );
            })}
          </div>
          {drag?.kind === 'block' && drag.moving && (
            <div
              className="drop-indicator"
              style={{ left: X(drag.drop < sequence.length ? starts[drag.drop] : len) }}
            />
          )}
          <div className="playhead" style={{ left: X(playhead) }} data-testid="playhead">
            <i />
          </div>
        </div>
      </div>
      {popover === 'clips' && (
        <Popover
          anchor={binBtn.current}
          placement="above"
          align="end"
          onClose={() => useUi.setState({ popover: null })}
        >
          <ClipsBin />
        </Popover>
      )}
    </section>
  );
}
