import { useEffect, useRef, useState } from 'react';
import { ipc, type OverlayInfo } from '../ipc';
import type { Pt, Rect } from '../model/types';
import { rectFromPoints } from '../model/geometry';

/**
 * Runs in one transparent always-on-top window per display (§4.5): draws the frozen screenshot dimmed
 * 35 %, a live crosshair and a W×H readout. Drag to select (⇧ while dragging arms the 5 s timer), Esc
 * cancels, mouse-up confirms. In window mode the window under the cursor is highlighted; click to snap.
 */
export function RegionOverlay() {
  const display = Number(new URLSearchParams(location.search).get('display') ?? 0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState<OverlayInfo | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const state = useRef<{
    cursor: Pt | null;
    start: Pt | null;
    end: Pt | null;
    timed: boolean;
    done: boolean;
  }>({
    cursor: null,
    start: null,
    end: null,
    timed: false,
    done: false,
  });

  useEffect(() => {
    void ipc.overlayInfo(display).then((i) => {
      const im = new Image();
      im.onload = () => {
        img.current = im;
        setInfo(i);
      };
      im.src = ipc.fileUrl(i.shotPath);
    });
  }, [display]);

  useEffect(() => {
    if (!info) return;
    const c = canvas.current!;
    const g = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    // screen CSS px ↔ shot physical px
    const kx = info.width / W;
    const ky = info.height / H;
    const toPhys = (r: Rect): Rect => ({
      x: Math.round(r.x * kx),
      y: Math.round(r.y * ky),
      w: Math.round(r.w * kx),
      h: Math.round(r.h * ky),
    });
    const windowAt = (p: Pt) =>
      info.windows.find(
        (w) => p.x * kx >= w.x && p.x * kx <= w.x + w.w && p.y * ky >= w.y && p.y * ky <= w.y + w.h,
      );

    const draw = () => {
      const s = state.current;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.drawImage(img.current!, 0, 0, W, H);
      let sel: Rect | null = null;
      if (info.mode === 'window' && s.cursor) {
        const w = windowAt(s.cursor);
        if (w) sel = { x: w.x / kx, y: w.y / ky, w: w.w / kx, h: w.h / ky };
      } else if (s.start && s.end) sel = rectFromPoints(s.start, s.end);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.rect(0, 0, W, H);
      if (sel) g.rect(sel.x, sel.y, sel.w, sel.h);
      g.fill('evenodd');
      if (sel) {
        g.strokeStyle = info.mode === 'window' ? '#2f8cff' : '#fff';
        g.lineWidth = info.mode === 'window' ? 3 : 1;
        g.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
      }
      if (s.cursor && info.mode !== 'window') {
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 1;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(0, s.cursor.y + 0.5);
        g.lineTo(W, s.cursor.y + 0.5);
        g.moveTo(s.cursor.x + 0.5, 0);
        g.lineTo(s.cursor.x + 0.5, H);
        g.stroke();
        g.setLineDash([]);
        const phys = sel ? toPhys(sel) : null;
        const label = phys
          ? `${phys.w} × ${phys.h}${s.timed ? '  ⏱ 5s' : ''}`
          : 'Drag to snap · ⇧ timed · Esc cancels';
        g.font = '600 12px Inter, system-ui, sans-serif';
        const tw = g.measureText(label).width + 14;
        const lx = Math.min(W - tw - 4, s.cursor.x + 14);
        const ly = Math.min(H - 26, s.cursor.y + 16);
        g.fillStyle = s.timed ? 'rgba(255,47,146,0.9)' : 'rgba(0,0,0,0.75)';
        g.beginPath();
        g.roundRect(lx, ly, tw, 22, 11);
        g.fill();
        g.fillStyle = '#fff';
        g.textBaseline = 'middle';
        g.fillText(label, lx + 7, ly + 11);
      }
    };

    const finish = (rect: Rect | null) => {
      if (state.current.done) return;
      state.current.done = true;
      void ipc.overlayFinish(display, rect && toPhys(rect), state.current.timed || info.mode === 'timed');
    };
    const pt = (e: PointerEvent): Pt => ({ x: e.clientX, y: e.clientY });
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (info.mode === 'window') {
        const w = windowAt(pt(e));
        finish(w ? { x: w.x / kx, y: w.y / ky, w: w.w / kx, h: w.h / ky } : null);
        return;
      }
      c.setPointerCapture(e.pointerId);
      state.current.start = state.current.end = pt(e);
      draw();
    };
    const move = (e: PointerEvent) => {
      const s = state.current;
      s.cursor = pt(e);
      if (s.start) {
        s.end = pt(e);
        if (e.shiftKey) s.timed = true; // Skitch: hold ⇧ while dragging to arm the timer
      }
      draw();
    };
    const up = (e: PointerEvent) => {
      const s = state.current;
      if (!s.start) return;
      const r = rectFromPoints(s.start, pt(e));
      s.start = s.end = null;
      if (r.w < 3 || r.h < 3) return draw();
      finish(r);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null);
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    draw();
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [info, display]);

  return (
    <canvas
      ref={canvas}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        cursor: info?.mode === 'window' ? 'pointer' : 'crosshair',
      }}
    />
  );
}
