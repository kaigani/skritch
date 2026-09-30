import { nanoid } from 'nanoid';
import { boundsOf, extendCanvasToFit, extendedCanvas, replaceObjects } from '../../model/commands/document';
import { dist, intersect, rectEq, rectFromPoints, union } from '../../model/geometry';
import { objectFrame, reframed, translated } from '../../model/objects';
import type { Document, Id, Pt, Rect, SkObject } from '../../model/types';
import { docState } from '../../state/document';
import { useUi } from '../../state/ui';
import { dragFrame, handleCursor, type HandleId } from '../handles';
import { hitHandle, hitTop } from '../hitTest';
import type { Renderer } from '../Renderer';
import type { PointerInfo, Tool } from './Tool';

const SNAP_PX = 6;

type Drag =
  | { kind: 'move'; ids: Id[]; start: Pt; originals: SkObject[]; frame: Rect; key: string; moved: boolean }
  | {
      kind: 'resize';
      id: Id;
      handle: HandleId;
      startFrame: Rect;
      original: SkObject;
      key: string;
      moved: boolean;
    }
  | { kind: 'marquee'; start: Pt; base: Id[] };

/**
 * Selection, move, resize, marquee, snapping and auto-extend-on-drag (§5.1, §5.2).
 * Drawing tools delegate to it when the pointer lands on an existing annotation or a handle.
 */
export class SelectTool implements Tool {
  cursor = 'default';
  private drag: Drag | null = null;

  constructor(private r: Renderer) {}

  /** True if pointer-down at `p` would grab something (used by drawing tools to delegate). */
  wouldGrab(p: PointerInfo, annotationsOnly: boolean): boolean {
    const doc = docState().doc!;
    if (hitHandle(this.r, doc, docState().selection, p.screen)) return true;
    const hit = hitTop(doc, p.doc, this.r.tol(), annotationsOnly ? (o) => o.type !== 'image' : undefined);
    return !!hit;
  }

  onDown(p: PointerInfo): void {
    const doc = docState().doc!;
    const sel = docState().selection;
    const h = hitHandle(this.r, doc, sel, p.screen);
    if (h) {
      this.drag = {
        kind: 'resize',
        id: h.obj.id,
        handle: h.handle,
        startFrame: objectFrame(h.obj),
        original: h.obj,
        key: `resize:${nanoid(6)}`,
        moved: false,
      };
      return;
    }
    const hit = hitTop(doc, p.doc, this.r.tol());
    if (hit) {
      if (p.shift) {
        docState().select(sel.includes(hit.id) ? sel.filter((i) => i !== hit.id) : [...sel, hit.id]);
        return;
      }
      const ids = sel.includes(hit.id) ? sel : [hit.id];
      if (ids !== sel) docState().select(ids);
      const originals = doc.objects.filter((o) => ids.includes(o.id));
      this.drag = {
        kind: 'move',
        ids,
        start: p.doc,
        originals,
        frame: originals.map(objectFrame).reduce(union),
        key: `move:${nanoid(6)}`,
        moved: false,
      };
      return;
    }
    if (!p.shift) docState().select([]);
    this.drag = { kind: 'marquee', start: p.doc, base: p.shift ? sel : [] };
  }

  onMove(p: PointerInfo): void {
    const d = this.drag;
    if (!d) return;
    const doc = docState().doc!;
    if (d.kind === 'marquee') {
      const m = rectFromPoints(d.start, p.doc);
      this.r.overlay.marquee = m;
      const hits = doc.objects.filter((o) => !o.locked && intersect(objectFrame(o), m)).map((o) => o.id);
      docState().select([...new Set([...d.base, ...hits])]);
      this.r.invalidate('interaction');
      return;
    }
    if (d.kind === 'move') {
      let dx = p.doc.x - d.start.x;
      let dy = p.doc.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * this.r.zoom < 2) return;
      this.beginFloating(d.ids);
      d.moved = true;
      if (p.shift) {
        // constrain to the dominant axis
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const snapped = p.mod ? { dx, dy, guides: [] } : this.snap(doc, d, dx, dy);
      this.r.overlay.guides = snapped.guides;
      const moved = d.originals.map((o) => translated(o, snapped.dx, snapped.dy));
      docState().execute(replaceObjects(moved, 'Move', d.key));
      this.updateProposal(d.ids);
      return;
    }
    // resize
    this.beginFloating([d.id]);
    d.moved = true;
    const o = d.original;
    let next: SkObject;
    if (o.type === 'arrow' || o.type === 'line') {
      let q = p.doc;
      const anchor = d.handle === 'from' ? o.to : o.from;
      if (p.shift) q = snapAngle(anchor, q);
      next = { ...o, [d.handle]: q } as SkObject;
    } else {
      // images: uniform by default, ⇧ frees the aspect; text/stamps always uniform; shapes: ⇧ = uniform
      const uniform =
        o.type === 'image' ? !p.shift : o.type === 'text' || o.type === 'stamp' ? true : p.shift;
      const f = dragFrame(d.startFrame, d.handle, p.doc, uniform, p.alt);
      next = reframed(o, d.startFrame, f);
    }
    docState().execute(replaceObjects([next], 'Resize', d.key));
    this.updateProposal([d.id]);
  }

  onUp(): void {
    const d = this.drag;
    this.drag = null;
    this.r.overlay.marquee = null;
    this.r.overlay.guides = [];
    this.endFloating();
    if (d && d.kind !== 'marquee' && d.moved) {
      const ids = d.kind === 'move' ? d.ids : [d.id];
      // §5.2: extend on pointer-up, coalesced with the drag so one undo restores both
      docState().execute(extendCanvasToFit(ids, d.key));
      docState().seal();
    }
  }

  cancel(): void {
    if (this.drag && this.drag.kind !== 'marquee' && this.drag.moved) docState().seal();
    this.drag = null;
    this.endFloating();
  }

  hoverCursor(p: PointerInfo): string {
    if (this.drag?.kind === 'move') return 'move';
    const doc = docState().doc!;
    const h = hitHandle(this.r, doc, docState().selection, p.screen);
    if (h) return handleCursor(h.handle);
    return hitTop(doc, p.doc, this.r.tol()) ? 'move' : this.cursor;
  }

  onDoubleClick(p: PointerInfo): void {
    const doc = docState().doc!;
    const hit = hitTop(doc, p.doc, this.r.tol());
    if (hit?.type === 'text') {
      docState().select([hit.id]);
      useUi.setState({ editingTextId: hit.id });
    }
  }

  onContextMenu(p: PointerInfo, client: Pt): void {
    const doc = docState().doc!;
    const hit = hitTop(doc, p.doc, this.r.tol());
    if (!hit) return;
    if (!docState().selection.includes(hit.id)) docState().select([hit.id]);
    useUi.setState({ contextMenu: { x: client.x, y: client.y } });
  }

  /** Moves the given objects to the interaction layer (composite cache excludes them). */
  private beginFloating(ids: Id[]): void {
    if (this.r.overlay.excluded.size) return;
    this.r.overlay.excluded = new Set(ids);
    this.r.invalidate('content');
  }

  private endFloating(): void {
    this.r.overlay.excluded = new Set();
    this.r.overlay.proposedCanvas = null;
    this.r.invalidate('all');
  }

  private updateProposal(ids: Id[]): void {
    const doc = docState().doc!;
    const b = boundsOf(doc, ids);
    const next = b ? extendedCanvas(doc.canvas, b) : doc.canvas;
    this.r.overlay.proposedCanvas = rectEq(next, doc.canvas) ? null : next;
    this.r.invalidate('interaction');
  }

  /** Snap the moving frame to canvas edges/centre and other image objects' edges/centres. */
  private snap(doc: Document, d: Extract<Drag, { kind: 'move' }>, dx: number, dy: number) {
    const tol = SNAP_PX / this.r.zoom;
    const xs: number[] = [doc.canvas.x, doc.canvas.x + doc.canvas.w / 2, doc.canvas.x + doc.canvas.w];
    const ys: number[] = [doc.canvas.y, doc.canvas.y + doc.canvas.h / 2, doc.canvas.y + doc.canvas.h];
    for (const o of doc.objects) {
      if (o.type !== 'image' || d.ids.includes(o.id)) continue;
      const f = objectFrame(o);
      xs.push(f.x, f.x + f.w / 2, f.x + f.w);
      ys.push(f.y, f.y + f.h / 2, f.y + f.h);
    }
    const f = d.frame;
    const best = (edges: number[], targets: number[]) => {
      let bestD = tol + 1;
      let at: number | undefined;
      for (const e of edges)
        for (const t of targets)
          if (Math.abs(t - e) < Math.abs(bestD)) {
            bestD = t - e;
            at = t;
          }
      return Math.abs(bestD) <= tol ? { delta: bestD, at } : null;
    };
    const sx = best([f.x + dx, f.x + dx + f.w / 2, f.x + dx + f.w], xs);
    const sy = best([f.y + dy, f.y + dy + f.h / 2, f.y + dy + f.h], ys);
    const guides: Array<{ x?: number; y?: number }> = [];
    if (sx) {
      dx += sx.delta;
      guides.push({ x: sx.at });
    }
    if (sy) {
      dy += sy.delta;
      guides.push({ y: sy.at });
    }
    return { dx, dy, guides };
  }
}

export function snapAngle(a: Pt, b: Pt): Pt {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const step = Math.PI / 4;
  const s = Math.round(ang / step) * step;
  const len = dist(a, b);
  return { x: a.x + Math.cos(s) * len, y: a.y + Math.sin(s) * len };
}
