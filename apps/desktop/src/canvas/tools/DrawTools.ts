import { nanoid } from 'nanoid';
import { addObjects, extendCanvasToFit, newId } from '../../model/commands/document';
import { dist, rectFromPoints } from '../../model/geometry';
import type { Document, Pt, SkObject } from '../../model/types';
import { docState } from '../../state/document';
import { ui } from '../../state/ui';
import type { Renderer } from '../Renderer';
import { SelectTool, snapAngle } from './SelectTool';
import type { PointerInfo, Tool } from './Tool';

/** Stamp radius and text size are screen-relative so they look the same at any zoom (Skitch feel). */
export const STAMP_RADII = [16, 22, 28, 36, 48];
export const TEXT_SIZES = [16, 22, 28, 40, 56];

/**
 * Base for tools that draw a new object from a press-drag-release gesture. Pressing on an existing
 * annotation (or a selection handle) grabs it instead, like Skitch.
 */
abstract class DrawTool implements Tool {
  cursor = 'crosshair';
  protected start: Pt | null = null;
  protected preview: SkObject | null = null;
  private select: SelectTool;
  private delegating = false;

  constructor(protected r: Renderer) {
    this.select = new SelectTool(r);
  }

  /** Builds the in-progress object for the gesture so far (null = nothing to draw yet). */
  protected abstract build(start: Pt, p: PointerInfo): SkObject | null;
  /** Minimum drag in screen px before the object counts. */
  protected minDrag = 4;

  onDown(p: PointerInfo): void {
    if (this.select.wouldGrab(p, true)) {
      this.delegating = true;
      this.select.onDown(p);
      return;
    }
    docState().select([]);
    this.start = p.doc;
    this.begin(p);
  }

  protected begin(_p: PointerInfo): void {}

  onMove(p: PointerInfo): void {
    if (this.delegating) return this.select.onMove(p);
    if (!this.start) return;
    this.preview = this.build(this.start, p);
    this.r.invalidate('interaction');
  }

  onUp(p: PointerInfo): void {
    if (this.delegating) {
      this.delegating = false;
      return this.select.onUp();
    }
    if (!this.start) return;
    const obj =
      dist(this.start, p.doc) * this.r.zoom >= this.minDrag
        ? this.build(this.start, p)
        : this.onClick(this.start, p);
    this.start = null;
    this.preview = null;
    if (obj) commitNew(obj);
    this.r.invalidate('interaction');
  }

  /** Object created by a click without drag (stamps, text). */
  protected onClick(_start: Pt, _p: PointerInfo): SkObject | null {
    return null;
  }

  hoverCursor(p: PointerInfo): string {
    if (this.delegating) return 'move';
    return this.select.wouldGrab(p, true) ? this.select.hoverCursor(p) : this.cursor;
  }

  onDoubleClick(p: PointerInfo): void {
    this.select.onDoubleClick(p);
  }

  onContextMenu(p: PointerInfo, client: Pt): void {
    this.select.onContextMenu(p, client);
  }

  renderOverlay(g: CanvasRenderingContext2D, doc: Document): void {
    if (this.preview) this.r.paintFloating(g, this.preview, doc);
  }

  cancel(): void {
    this.select.cancel();
    this.start = null;
    this.preview = null;
  }
}

/** Adds an object, extends the canvas to include it (one undo step), and selects it. */
export function commitNew(obj: SkObject): void {
  const key = `add:${nanoid(6)}`;
  docState().execute({ ...addObjects([obj]), coalesceKey: key });
  docState().execute(extendCanvasToFit([obj.id], key));
  docState().seal();
  docState().select([obj.id]);
}

const style = () => ({ color: ui().color, size: ui().size });

export class ArrowTool extends DrawTool {
  protected build(start: Pt, p: PointerInfo): SkObject {
    const end = p.shift ? snapAngle(start, p.doc) : p.doc;
    // ⌥/Alt reverses direction
    const [from, to] = p.alt ? [end, start] : [start, end];
    return { id: this.preview?.id ?? newId(), type: 'arrow', from, to, ...style() };
  }
}

export class LineTool extends DrawTool {
  protected build(start: Pt, p: PointerInfo): SkObject {
    const to = p.shift ? snapAngle(start, p.doc) : p.doc;
    return { id: this.preview?.id ?? newId(), type: 'line', from: start, to, ...style() };
  }
}

export class ShapeTool extends DrawTool {
  constructor(
    r: Renderer,
    private shape: 'rect' | 'roundRect' | 'ellipse',
  ) {
    super(r);
  }
  protected build(start: Pt, p: PointerInfo): SkObject {
    let end = p.doc;
    if (p.shift) {
      const s = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      end = {
        x: start.x + s * Math.sign(end.x - start.x || 1),
        y: start.y + s * Math.sign(end.y - start.y || 1),
      };
    }
    const rect = p.alt
      ? {
          x: start.x - (end.x - start.x),
          y: start.y - (end.y - start.y),
          w: 2 * (end.x - start.x),
          h: 2 * (end.y - start.y),
        }
      : rectFromPoints(start, end);
    return {
      id: this.preview?.id ?? newId(),
      type: 'shape',
      shape: this.shape,
      rect: rectFromPoints({ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }),
      ...style(),
    };
  }
}

/** Freehand pen and highlighter share point collection. */
export class StrokeTool extends DrawTool {
  private points: Pt[] = [];
  protected minDrag = 0;
  constructor(
    r: Renderer,
    private kind: 'pen' | 'highlight',
  ) {
    super(r);
  }
  protected begin(p: PointerInfo): void {
    this.points = [p.doc];
  }
  protected build(_start: Pt, p: PointerInfo): SkObject {
    const last = this.points[this.points.length - 1];
    if (dist(last, p.doc) * this.r.zoom >= 1.5) this.points.push(p.doc);
    return {
      id: this.preview?.id ?? newId(),
      type: this.kind,
      points: this.points.slice(),
      ...style(),
    } as SkObject;
  }
  protected onClick(start: Pt): SkObject {
    return {
      id: newId(),
      type: this.kind,
      points: [start, { x: start.x + 0.5, y: start.y }],
      ...style(),
    } as SkObject;
  }
}

export class PixelateTool extends DrawTool {
  protected build(start: Pt, p: PointerInfo): SkObject {
    return { id: this.preview?.id ?? newId(), type: 'pixelate', rect: rectFromPoints(start, p.doc) };
  }
}

export class StampTool extends DrawTool {
  cursor = 'copy';
  protected build(start: Pt, p: PointerInfo): SkObject {
    return {
      id: this.preview?.id ?? newId(),
      type: 'stamp',
      glyph: ui().stamp,
      center: start,
      radius: Math.max(8 / this.r.zoom, dist(start, p.doc)),
      color: ui().color,
    };
  }
  protected onClick(start: Pt): SkObject {
    const radius = STAMP_RADII[ui().size - 1] / Math.min(1, this.r.zoom);
    return { id: newId(), type: 'stamp', glyph: ui().stamp, center: start, radius, color: ui().color };
  }
}
