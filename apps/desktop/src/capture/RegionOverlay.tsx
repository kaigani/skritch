import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ipc, type OverlayInfo } from '../ipc';
import type { Pt, Rect } from '../model/types';
import { rectFromPoints } from '../model/geometry';
import { moveSelection, resizeSelection, screenPoint, sizeSelection, type Corner } from './selection';
import type { Prefs } from '../state/prefs';
import './overlay.css';

type Drag = { start: Pt; original: Rect | null; kind: 'draw' | 'move' | Corner; pointerId: number };
const corners: Corner[] = ['nw', 'ne', 'sw', 'se'];
const cornerNames = { nw: 'top left', ne: 'top right', sw: 'bottom left', se: 'bottom right' };

export function RegionOverlay() {
  const display = Number(new URLSearchParams(location.search).get('display') ?? 0);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const finishing = useRef(false);
  const [info, setInfo] = useState<OverlayInfo | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [timed, setTimed] = useState(false);
  const timedRef = useRef(false);
  const [ratio, setRatio] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  const setTimer = (on: boolean) => {
    timedRef.current = on;
    setTimed(on);
  };

  useEffect(() => {
    let disposed = false;
    void Promise.all([ipc.overlayInfo(display), ipc.prefsGet<Partial<Prefs>>('prefs')])
      .then(async ([i, p]) => {
        const im = new Image();
        im.src = ipc.fileUrl(i.shotPath);
        await im.decode();
        if (disposed) return;
        image.current = im;
        setAdvanced(p?.advancedCapture === true);
        setTimer(i.mode === 'timed');
        setInfo(i);
        root.current?.focus();
      })
      .catch(() => {
        if (!disposed) setError('Could not load the capture. Cancel and try again.');
      });
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', resize);
    };
  }, [display]);

  const finish = useCallback(
    async (rect: Rect | null) => {
      if (finishing.current) return;
      finishing.current = true;
      setBusy(true);
      try {
        await ipc.overlayFinish(display, rect, timedRef.current);
      } catch {
        finishing.current = false;
        setBusy(false);
        setError('Could not finish this capture. Try again or cancel.');
      }
    },
    [display],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void finish(null);
      }
      if (
        e.key === 'Enter' &&
        selection &&
        adjusting &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLButtonElement)
      ) {
        e.preventDefault();
        void finish(selection);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [finish, selection, adjusting]);

  const kx = info ? info.width / viewport.width : 1;
  const ky = info ? info.height / viewport.height : 1;
  const windowAt = (p: Pt) =>
    info?.windows.find((w) => p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h);
  const hoveredWindow = info?.mode === 'window' && !selection && cursor ? windowAt(cursor) : null;
  const shown = selection ?? hoveredWindow;

  useEffect(() => {
    if (!info || !image.current || !canvas.current) return;
    const c = canvas.current;
    const g = c.getContext('2d')!;
    const dpr = devicePixelRatio || 1;
    c.width = Math.round(viewport.width * dpr);
    c.height = Math.round(viewport.height * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(image.current, 0, 0, viewport.width, viewport.height);
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.rect(0, 0, viewport.width, viewport.height);
    if (shown) g.rect(shown.x / kx, shown.y / ky, shown.w / kx, shown.h / ky);
    g.fill('evenodd');
    if (shown) {
      g.strokeStyle = '#FA1262';
      g.lineWidth = 2;
      g.strokeRect(shown.x / kx, shown.y / ky, shown.w / kx, shown.h / ky);
    }
    if (cursor && !adjusting && info.mode !== 'window') {
      g.strokeStyle = 'rgba(255,255,255,.7)';
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(0, cursor.y / ky);
      g.lineTo(viewport.width, cursor.y / ky);
      g.moveTo(cursor.x / kx, 0);
      g.lineTo(cursor.x / kx, viewport.height);
      g.stroke();
    }
  }, [info, shown, cursor, adjusting, kx, ky, viewport]);

  const point = (e: ReactPointerEvent): Pt => screenPoint({ x: e.clientX * kx, y: e.clientY * ky }, info!);
  const begin = (e: ReactPointerEvent, kind: Drag['kind']) => {
    if (!info || e.button !== 0 || busy) return;
    e.preventDefault();
    e.stopPropagation();
    root.current?.focus();
    const start = point(e);
    if (e.shiftKey) setTimer(true);
    if (kind === 'draw' && info.mode === 'window') {
      const w = windowAt(start);
      if (!w) return;
      const a = screenPoint(w, info);
      const b = screenPoint({ x: w.x + w.w, y: w.y + w.h }, info);
      const r = rectFromPoints(a, b);
      if (r.w < 1 || r.h < 1) return;
      if (!advanced) {
        void finish(r);
        return;
      }
      setSelection(r);
      setAdjusting(true);
      return;
    }
    drag.current = { start, original: selection, kind, pointerId: e.pointerId };
    root.current!.setPointerCapture(e.pointerId);
    if (kind === 'draw') {
      setSelection(null);
      setAdjusting(false);
    }
  };
  const draggedRect = (p: Pt): Rect => {
    const d = drag.current!;
    if (d.kind === 'draw') return rectFromPoints(d.start, p);
    if (d.kind === 'move')
      return moveSelection(d.original!, { x: p.x - d.start.x, y: p.y - d.start.y }, info!);
    return resizeSelection(d.original!, d.kind, p, info!, ratio);
  };
  const move = (e: ReactPointerEvent) => {
    if (!info || busy) return;
    const p = point(e);
    setCursor(p);
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    if (e.shiftKey) setTimer(true);
    setSelection(draggedRect(p));
  };
  const up = (e: ReactPointerEvent) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    const r = draggedRect(point(e));
    drag.current = null;
    root.current?.releasePointerCapture(e.pointerId);
    if (r.w < 1 || r.h < 1) {
      setSelection(null);
      return;
    }
    setSelection(r);
    if (advanced) setAdjusting(true);
    else void finish(r);
  };
  const cancelDrag = () => {
    if (!drag.current) return;
    setSelection(drag.current.original);
    setAdjusting(!!drag.current.original);
    drag.current = null;
  };
  const controls = advanced && adjusting && selection && info;
  const panelWidth = Math.min(328, viewport.width - 24);
  const panelHeight = 250;
  const panelInside =
    selection &&
    (selection.y + selection.h) / ky + 18 + panelHeight > viewport.height - 12 &&
    selection.y / ky - panelHeight - 18 < 12;
  const panelLeft = selection
    ? Math.max(
        12,
        Math.min(
          viewport.width - panelWidth - 12,
          (selection.x + selection.w) / kx - panelWidth - (panelInside ? 24 : 0),
        ),
      )
    : 12;
  const panelTop = selection
    ? Math.max(
        12,
        Math.min(
          viewport.height - panelHeight - 12,
          (selection.y + selection.h) / ky + 18 + panelHeight <= viewport.height - 12
            ? (selection.y + selection.h) / ky + 18
            : selection.y / ky - panelHeight - 18 >= 12
              ? selection.y / ky - panelHeight - 18
              : (selection.y + selection.h) / ky - panelHeight - 24,
        ),
      )
    : 12;

  return (
    <div
      ref={root}
      className="capture-overlay"
      tabIndex={-1}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancelDrag}
    >
      <canvas
        ref={canvas}
        aria-label="Select capture area"
        onPointerDown={(e) => begin(e, 'draw')}
        style={{ cursor: info?.mode === 'window' ? 'pointer' : 'crosshair' }}
      />
      {!controls && !error && (
        <div className="capture-hint" role="status">
          {!info
            ? 'Preparing capture…'
            : selection
              ? `${selection.w} × ${selection.h} px`
              : info.mode === 'window'
                ? 'Click a window'
                : 'Drag to select an area'}
          {info && (
            <span>
              {timed ? '5-second timer · ' : ''}
              {advanced ? 'Adjust before capturing · ' : '⇧ for timer · '}Esc to cancel
            </span>
          )}
        </div>
      )}
      {controls && (
        <>
          <div
            className="capture-selection"
            role="group"
            aria-label="Move capture area"
            tabIndex={0}
            style={{
              left: selection.x / kx,
              top: selection.y / ky,
              width: selection.w / kx,
              height: selection.h / ky,
            }}
            onPointerDown={(e) => begin(e, 'move')}
            onKeyDown={(e) => {
              if (!e.key.startsWith('Arrow')) return;
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              setSelection(
                moveSelection(
                  selection,
                  {
                    x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
                    y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
                  },
                  info,
                ),
              );
            }}
          />
          {corners.map((corner) => {
            const x = selection.x + (corner.includes('e') ? selection.w : 0);
            const y = selection.y + (corner.includes('s') ? selection.h : 0);
            return (
              <button
                key={corner}
                className={`capture-handle ${corner}`}
                aria-label={`Resize ${cornerNames[corner]}`}
                style={{
                  left: Math.max(9, Math.min(viewport.width - 9, x / kx)),
                  top: Math.max(9, Math.min(viewport.height - 9, y / ky)),
                }}
                onPointerDown={(e) => begin(e, corner)}
                onKeyDown={(e) => {
                  if (!e.key.startsWith('Arrow')) return;
                  e.preventDefault();
                  const step = e.shiftKey ? 10 : 1;
                  setSelection(
                    resizeSelection(
                      selection,
                      corner,
                      {
                        x: x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
                        y: y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0),
                      },
                      info,
                      ratio,
                    ),
                  );
                }}
              />
            );
          })}
          <section
            className="capture-panel"
            aria-label="Advanced capture options"
            style={{ left: panelLeft, top: panelTop, width: panelWidth }}
          >
            <header>
              Fine-tune your capture <span>pixels</span>
            </header>
            <div className="capture-dimensions">
              <Dimension
                label="Width"
                value={selection.w}
                max={info.width - selection.x}
                onChange={(value) => setSelection(sizeSelection(selection, 'w', value, info, ratio))}
              />
              <Dimension
                label="Height"
                value={selection.h}
                max={info.height - selection.y}
                onChange={(value) => setSelection(sizeSelection(selection, 'h', value, info, ratio))}
              />
              <button
                className="capture-lock"
                aria-label="Lock aspect ratio"
                aria-pressed={!!ratio}
                onClick={() => setRatio(ratio ? undefined : selection.w / selection.h)}
                title="Lock aspect ratio"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
                    transform="translate(1 0)"
                  />
                </svg>
              </button>
            </div>
            <p className="capture-instruction">
              {timed ? 'Capture starts a 5-second countdown.' : 'Drag the area or its corners to adjust.'}
            </p>
            <div className="capture-actions">
              <button disabled={busy} onClick={() => void finish(null)}>
                Cancel
              </button>
              <button
                className="capture-mode"
                disabled={busy}
                aria-label="Timed capture"
                aria-pressed={timed}
                title="5-second timer"
                onClick={() => setTimer(!timed)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="13" r="8" />
                  <path d="M12 8v5l3 2M9 2h6M12 2v3" />
                </svg>
              </button>
              <button
                className="capture-mode"
                disabled={busy}
                aria-label="Full screen capture"
                title="Select this entire display"
                onClick={() => {
                  setSelection({ x: 0, y: 0, w: info.width, h: info.height });
                  setRatio(undefined);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />
                  <rect x="7" y="7" width="10" height="10" rx="2" />
                </svg>
              </button>
              <button className="capture-confirm" disabled={busy} onClick={() => void finish(selection)}>
                {busy ? 'Capturing…' : 'Capture'}
              </button>
            </div>
          </section>
        </>
      )}
      {error && (
        <div className="capture-error" role="alert">
          {error}
          <button onClick={() => void finish(null)}>Cancel capture</button>
        </div>
      )}
    </div>
  );
}

function Dimension({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="capture-dimension">
      {label}
      <input
        aria-label={label}
        type="number"
        min={1}
        max={max}
        step={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 1) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
