// Layered Canvas2D renderer (§4.3): backdrop / content / interaction canvases, one rAF loop that
// idles when nothing is dirty, imperative tool strategies, zoom/pan with HiDPI correctness.
import { normRect } from '../model/geometry';
import { objectFrame, objectBounds } from '../model/objects';
import type { Document, Id, Pt, Rect, SkObject } from '../model/types';
import { bitmaps, docState, useDoc } from '../state/document';
import { ui, useUi } from '../state/ui';
import { checkerPattern, paintObject, type PaintEnv } from './paint';
import { HANDLE_RADIUS, objectHandles } from './handles';
import type { Tool, PointerInfo } from './tools/Tool';
import { createTool } from './tools';
import { BRAND_PINK } from '../theme';

export const BACKDROP = '#b8b8b8';
export const SELECTION_BLUE = '#2f8cff';
export const GUIDE_PINK = BRAND_PINK;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const FIT_MARGIN = 36;

export interface Overlay {
  /** Objects currently drawn on the interaction layer instead of the content layer. */
  excluded: Set<Id>;
  /** Proposed canvas rect while dragging past the edge (§5.2). */
  proposedCanvas: Rect | null;
  guides: Array<{ x?: number; y?: number }>;
  marquee: Rect | null;
}

export class Renderer {
  readonly backdrop: HTMLCanvasElement;
  readonly content: HTMLCanvasElement;
  readonly interaction: HTMLCanvasElement;
  zoom = 1;
  /** Screen (CSS px) position of document origin. */
  ox = 0;
  oy = 0;
  cssW = 0;
  cssH = 0;
  dpr = 1;
  tool: Tool;
  overlay: Overlay = { excluded: new Set(), proposedCanvas: null, guides: [], marquee: null };

  private dirtyBackdrop = true;
  private dirtyContent = true;
  private dirtyInteraction = true;
  private raf = 0;
  private unsub: Array<() => void> = [];
  private ro: ResizeObserver;
  private lastCanvas: Rect | null = null;
  private lastDocId: string | null = null;
  private spaceDown = false;
  private panning: { x: number; y: number; ox: number; oy: number } | null = null;
  private checker: CanvasPattern | null = null;
  onViewChange?: () => void;

  constructor(private host: HTMLElement) {
    const mk = (cls: string) => {
      const c = document.createElement('canvas');
      c.className = `layer ${cls}`;
      host.appendChild(c);
      return c;
    };
    this.backdrop = mk('backdrop');
    this.content = mk('content');
    this.interaction = mk('interaction');
    this.tool = createTool(ui().tool, this);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    this.unsub.push(
      useDoc.subscribe((s, prev) => {
        if (s.doc !== prev.doc) this.onDocChange(s.doc);
        if (s.selection !== prev.selection) this.invalidate('interaction');
      }),
      useUi.subscribe((s, prev) => {
        if (s.tool !== prev.tool || s.shape !== prev.shape) this.setTool();
        if (s.crop !== prev.crop) this.invalidate('all');
        if (s.editingTextId !== prev.editingTextId) this.invalidate('content');
      }),
    );
    this.bindPointer();
    this.onDocChange(docState().doc);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsub.forEach((u) => u());
    this.host.replaceChildren();
  }

  // ---------------------------------------------------------------- view transform
  toDoc(sx: number, sy: number): Pt {
    return { x: (sx - this.ox) / this.zoom, y: (sy - this.oy) / this.zoom };
  }
  toScreen(p: Pt): Pt {
    return { x: p.x * this.zoom + this.ox, y: p.y * this.zoom + this.oy };
  }
  screenRect(r: Rect): Rect {
    return {
      x: r.x * this.zoom + this.ox,
      y: r.y * this.zoom + this.oy,
      w: r.w * this.zoom,
      h: r.h * this.zoom,
    };
  }
  /** Tolerance in doc units for a number of screen px. */
  tol(px = 8): number {
    return px / this.zoom;
  }
  viewportCenterDoc(): Pt {
    return this.toDoc(this.cssW / 2, this.cssH / 2);
  }

  fit(): void {
    const doc = docState().doc;
    if (!doc) return;
    const c = doc.canvas;
    const z = Math.min(1, (this.cssW - FIT_MARGIN * 2) / c.w, (this.cssH - FIT_MARGIN * 2) / c.h);
    this.setZoom(Math.max(MIN_ZOOM, z), undefined, true);
    this.center();
  }
  private fitsViewport(c: Rect): boolean {
    const r = this.screenRect(c);
    return r.x >= 0 && r.y >= 0 && r.x + r.w <= this.cssW && r.y + r.h <= this.cssH;
  }

  center(): void {
    const doc = docState().doc;
    if (!doc) return;
    const c = doc.canvas;
    this.ox = Math.round(this.cssW / 2 - (c.x + c.w / 2) * this.zoom);
    this.oy = Math.round(this.cssH / 2 - (c.y + c.h / 2) * this.zoom);
    this.invalidate('all');
  }
  /** Zooms about a screen point (defaults to the viewport centre). */
  setZoom(z: number, about?: Pt, auto = false): void {
    const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    const a = about ?? { x: this.cssW / 2, y: this.cssH / 2 };
    const d = this.toDoc(a.x, a.y);
    this.zoom = nz;
    this.ox = a.x - d.x * nz;
    this.oy = a.y - d.y * nz;
    useUi.setState({ zoom: nz, autoFit: auto });
    this.invalidate('all');
    this.onViewChange?.();
  }
  zoomStep(dir: 1 | -1): void {
    const steps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
    const z = this.zoom;
    const next =
      dir > 0
        ? (steps.find((s) => s > z + 1e-3) ?? MAX_ZOOM)
        : ([...steps].reverse().find((s) => s < z - 1e-3) ?? MIN_ZOOM);
    this.setZoom(next);
  }
  panBy(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
    this.invalidate('all');
    this.onViewChange?.();
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.dpr = window.devicePixelRatio || 1;
    for (const c of [this.backdrop, this.content, this.interaction]) {
      c.width = Math.round(this.cssW * this.dpr);
      c.height = Math.round(this.cssH * this.dpr);
      c.style.width = `${this.cssW}px`;
      c.style.height = `${this.cssH}px`;
    }
    this.checker = null;
    if (ui().autoFit) this.fit();
    this.invalidate('all');
  }

  private onDocChange(doc: Document | null): void {
    if (!doc) {
      this.lastDocId = null;
      this.invalidate('all');
      return;
    }
    if (doc.id !== this.lastDocId) {
      this.lastDocId = doc.id;
      this.lastCanvas = doc.canvas;
      // captures larger than the viewport open at Fit, smaller ones at 100 % (§5.4)
      useUi.setState({ autoFit: true });
      this.fit();
    } else if (this.lastCanvas !== doc.canvas) {
      this.lastCanvas = doc.canvas;
      // keep the whole canvas in view after it grows, unless the user has zoomed manually
      if (ui().autoFit && !this.overlay.excluded.size && !this.fitsViewport(doc.canvas)) this.fit();
      this.invalidate('backdrop');
    } else if (this.onlyFloatingChanged(doc)) {
      // Composite cache: during a drag only the floating objects change, so the content layer
      // (rendered once without them) is reused and only the interaction layer redraws.
      this.lastObjects = doc.objects;
      this.invalidate('interaction');
      return;
    }
    this.lastObjects = doc.objects;
    this.invalidate('all');
  }

  private lastObjects: SkObject[] = [];
  private onlyFloatingChanged(doc: Document): boolean {
    const ex = this.overlay.excluded;
    if (!ex.size) return false;
    const a = this.lastObjects.filter((o) => !ex.has(o.id));
    const b = doc.objects.filter((o) => !ex.has(o.id));
    return a.length === b.length && a.every((o, i) => o === b[i]);
  }

  setTool(): void {
    this.tool.cancel?.();
    this.tool = createTool(ui().tool, this);
    this.overlay = { excluded: new Set(), proposedCanvas: null, guides: [], marquee: null };
    this.interaction.style.cursor = this.tool.cursor;
    this.invalidate('all');
  }

  invalidate(which: 'backdrop' | 'content' | 'interaction' | 'all'): void {
    if (which === 'backdrop' || which === 'all') this.dirtyBackdrop = true;
    if (which === 'content' || which === 'all') this.dirtyContent = true;
    this.dirtyInteraction = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.raf = 0;
    const doc = docState().doc;
    if (this.dirtyBackdrop) this.drawBackdrop(doc);
    if (this.dirtyContent) this.drawContent(doc);
    if (this.dirtyInteraction) this.drawInteraction(doc);
    this.dirtyBackdrop = this.dirtyContent = this.dirtyInteraction = false;
  }

  private ctx(c: HTMLCanvasElement, docSpace: boolean): CanvasRenderingContext2D {
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    if (docSpace)
      g.setTransform(
        this.dpr * this.zoom,
        0,
        0,
        this.dpr * this.zoom,
        this.dpr * this.ox,
        this.dpr * this.oy,
      );
    else g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return g;
  }

  /** The canvas rect currently shown: the crop proposal while cropping, else the document canvas. */
  private shownCanvas(doc: Document): Rect {
    const crop = ui().crop;
    return crop && !crop.targetId && crop.mode !== 'scale' ? crop.rect : doc.canvas;
  }

  private drawBackdrop(doc: Document | null): void {
    const g = this.ctx(this.backdrop, false);
    g.fillStyle = BACKDROP;
    g.fillRect(0, 0, this.cssW, this.cssH);
    if (!doc) return;
    const r = this.screenRect(this.shownCanvas(doc));
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 4;
    if (doc.background.kind === 'color') g.fillStyle = doc.background.color;
    else g.fillStyle = (this.checker ??= checkerPattern(g, 8)) ?? '#fff';
    g.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
    g.restore();
  }

  paintEnv(doc: Document): PaintEnv {
    return { bitmap: (id) => bitmaps.get(id), canvasMinSide: Math.min(doc.canvas.w, doc.canvas.h) };
  }

  private drawContent(doc: Document | null): void {
    const g = this.ctx(this.content, true);
    if (!doc) return;
    const cropping = !!ui().crop && !ui().crop!.targetId && ui().crop!.mode !== 'scale';
    const shown = this.shownCanvas(doc);
    g.save();
    if (!cropping) {
      // Crop is non-destructive: objects outside the canvas are retained but clipped (§5.3).
      g.beginPath();
      g.rect(shown.x, shown.y, shown.w, shown.h);
      g.clip();
    }
    const env = this.paintEnv(doc);
    const editing = ui().editingTextId;
    for (const o of doc.objects) {
      if (this.overlay.excluded.has(o.id) || o.id === editing) continue;
      paintObject(g, o, env);
    }
    g.restore();
  }

  private drawInteraction(doc: Document | null): void {
    const g = this.ctx(this.interaction, false);
    if (!doc) return;
    const { excluded, proposedCanvas, guides, marquee } = this.overlay;

    if (proposedCanvas) {
      const r = this.screenRect(proposedCanvas);
      const c = this.screenRect(doc.canvas);
      g.save();
      // tint only the newly exposed area with the background fill
      g.fillStyle = doc.background.kind === 'color' ? doc.background.color : 'rgba(255,255,255,0.6)';
      g.globalAlpha = 0.7;
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.rect(c.x, c.y, c.w, c.h);
      g.fill('evenodd');
      g.globalAlpha = 1;
      g.setLineDash([6, 4]);
      g.strokeStyle = SELECTION_BLUE;
      g.lineWidth = 1.5;
      g.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      g.restore();
    }

    if (excluded.size) for (const o of doc.objects) if (excluded.has(o.id)) this.paintFloating(g, o, doc);

    for (const gd of guides) {
      g.save();
      g.strokeStyle = GUIDE_PINK;
      g.lineWidth = 1;
      g.beginPath();
      if (gd.x !== undefined) {
        const x = Math.round(this.toScreen({ x: gd.x, y: 0 }).x) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, this.cssH);
      }
      if (gd.y !== undefined) {
        const y = Math.round(this.toScreen({ x: 0, y: gd.y }).y) + 0.5;
        g.moveTo(0, y);
        g.lineTo(this.cssW, y);
      }
      g.stroke();
      g.restore();
    }

    if (!ui().crop && !ui().editingTextId) this.drawSelection(g, doc);

    if (marquee) {
      const r = this.screenRect(marquee);
      g.save();
      g.fillStyle = 'rgba(47,140,255,0.12)';
      g.strokeStyle = SELECTION_BLUE;
      g.lineWidth = 1;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      g.restore();
    }

    this.tool.renderOverlay?.(g, doc);
  }

  /** Paints an object on the interaction layer (dragged objects, in-progress drawing). */
  paintFloating(g: CanvasRenderingContext2D, o: SkObject, doc: Document): void {
    g.save();
    g.setTransform(this.dpr * this.zoom, 0, 0, this.dpr * this.zoom, this.dpr * this.ox, this.dpr * this.oy);
    if (o.type === 'pixelate') {
      // pixelate samples what's beneath it: copy the content layer under its rect first
      const r = normRect(o.rect);
      g.save();
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(this.content, 0, 0);
      g.restore();
    }
    paintObject(g, o, this.paintEnv(doc));
    g.restore();
  }

  private drawSelection(g: CanvasRenderingContext2D, doc: Document): void {
    const sel = new Set(docState().selection);
    if (!sel.size) return;
    for (const o of doc.objects) {
      if (!sel.has(o.id)) continue;
      g.save();
      g.strokeStyle = SELECTION_BLUE;
      g.lineWidth = 1;
      if (o.type !== 'arrow' && o.type !== 'line') {
        const r = this.screenRect(
          o.type === 'text' || o.type === 'image' || o.type === 'stamp' || o.type === 'pixelate'
            ? objectFrame(o)
            : objectBounds(o),
        );
        g.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      }
      if (sel.size === 1) {
        for (const h of objectHandles(o)) {
          const p = this.toScreen(h.p);
          g.beginPath();
          g.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
          g.fillStyle = '#fff';
          g.shadowColor = 'rgba(0,0,0,0.35)';
          g.shadowBlur = 2;
          g.fill();
          g.shadowColor = 'transparent';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      g.restore();
    }
  }

  // ---------------------------------------------------------------- input
  private info(e: PointerEvent | MouseEvent): PointerInfo {
    const r = this.interaction.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return {
      screen,
      doc: this.toDoc(screen.x, screen.y),
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.ctrlKey || e.metaKey,
      button: e.button,
      detail: e.detail,
    };
  }

  private bindPointer(): void {
    const el = this.interaction;
    el.style.cursor = this.tool.cursor;
    el.addEventListener('pointerdown', (e) => {
      if (!docState().doc) return;
      if (ui().editingTextId) return; // the textarea blur commits first
      e.preventDefault(); // no compatibility mousedown → no focus change (keeps the text editor focused)
      (document.activeElement as HTMLElement | null)?.blur?.(); // …so release inputs (e.g. crop W/H) manually
      el.setPointerCapture(e.pointerId);
      if (e.button === 1 || this.spaceDown) {
        this.panning = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy };
        el.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== 0) return;
      if (ui().popover) useUi.setState({ popover: null });
      this.tool.onDown(this.info(e));
      this.invalidate('interaction');
    });
    el.addEventListener('pointermove', (e) => {
      if (this.panning) {
        this.ox = this.panning.ox + (e.clientX - this.panning.x);
        this.oy = this.panning.oy + (e.clientY - this.panning.y);
        this.invalidate('all');
        return;
      }
      if (!docState().doc) return;
      this.tool.onMove(this.info(e));
      const cur = this.tool.hoverCursor?.(this.info(e)) ?? this.tool.cursor;
      if (el.style.cursor !== cur) el.style.cursor = cur;
    });
    const up = (e: PointerEvent) => {
      if (this.panning) {
        this.panning = null;
        el.style.cursor = this.spaceDown ? 'grab' : this.tool.cursor;
        this.onViewChange?.();
        return;
      }
      if (!docState().doc) return;
      this.tool.onUp(this.info(e));
      this.invalidate('interaction');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dblclick', (e) => this.tool.onDoubleClick?.(this.info(e)));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.tool.onContextMenu?.(this.info(e), { x: e.clientX, y: e.clientY });
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!docState().doc) return;
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect();
          const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
          this.setZoom(this.zoom * k, { x: e.clientX - r.left, y: e.clientY - r.top });
        } else {
          const k = e.deltaMode === 1 ? 16 : 1;
          this.panBy(-(e.shiftKey ? e.deltaY : e.deltaX) * k, -(e.shiftKey ? 0 : e.deltaY) * k);
        }
      },
      { passive: false },
    );
    const keyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        if (!this.spaceDown && !ui().editingTextId && ui().mode === 'image') {
          this.spaceDown = true;
          el.style.cursor = 'grab';
        }
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        el.style.cursor = this.tool.cursor;
      }
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    this.unsub.push(() => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
    });
  }
}

export const isTyping = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

/** The single live renderer (one document view per window). */
export let renderer: Renderer | null = null;
export const setRenderer = (r: Renderer | null) => {
  renderer = r;
};
