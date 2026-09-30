import {
  boundsOfPoints,
  distToPolyline,
  distToSegment,
  ellipseEdgeDistance,
  containsPt,
  inflate,
  normRect,
  rectEdgeDistance,
} from '../geometry';
import type { Pt, Rect, SkObject, TextObject } from '../types';
import { strokePx, haloPx } from '../types';
import { arrowPolygon } from './arrow';

// ---------------------------------------------------------------------------
// Text measurement is injected by the renderer (canvas measureText). The pure default is an
// approximation good enough for unit tests.
// ---------------------------------------------------------------------------
export type TextMeasurer = (text: string, fontSize: number) => { w: number; h: number };

let measurer: TextMeasurer = (text, fontSize) => {
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * fontSize * 0.58;
  return { w: Math.max(w, fontSize * 0.5), h: lines.length * fontSize * TEXT_LINE_HEIGHT };
};
export const TEXT_LINE_HEIGHT = 1.2;
export const setTextMeasurer = (m: TextMeasurer): void => {
  measurer = m;
};
export const measureText = (text: string, fontSize: number) => measurer(text || ' ', fontSize);

export function textBounds(o: TextObject): Rect {
  const m = measureText(o.text, o.fontSize);
  return { x: o.pos.x, y: o.pos.y, w: m.w, h: m.h };
}

/** Visual bounds including stroke and halo, in document space. */
export function objectBounds(o: SkObject): Rect {
  switch (o.type) {
    case 'image':
      return normRect({ x: o.x, y: o.y, w: o.w, h: o.h });
    case 'shape':
    case 'pixelate': {
      const r = normRect(o.rect);
      if (o.type === 'pixelate') return r;
      const s = strokePx(o.size);
      return inflate(r, s / 2 + haloPx(s));
    }
    case 'arrow': {
      const b = boundsOfPoints(arrowPolygon(o.from, o.to, strokePx(o.size)));
      return inflate(b, haloPx(strokePx(o.size)));
    }
    case 'line': {
      const s = strokePx(o.size);
      return inflate(boundsOfPoints([o.from, o.to]), s / 2 + haloPx(s));
    }
    case 'pen':
    case 'highlight': {
      const s = o.type === 'highlight' ? highlightWidth(o.size) : strokePx(o.size);
      return inflate(boundsOfPoints(o.points), s / 2 + (o.type === 'pen' ? haloPx(s) : 0));
    }
    case 'text':
      return inflate(textBounds(o), haloPx(o.fontSize * 0.12));
    case 'stamp':
      return { x: o.center.x - o.radius, y: o.center.y - o.radius, w: o.radius * 2, h: o.radius * 2 };
  }
}

/** Geometric bounds without stroke inflation — used for handles and snapping. */
export function objectFrame(o: SkObject): Rect {
  switch (o.type) {
    case 'image':
      return normRect({ x: o.x, y: o.y, w: o.w, h: o.h });
    case 'shape':
    case 'pixelate':
      return normRect(o.rect);
    case 'arrow':
    case 'line':
      return boundsOfPoints([o.from, o.to]);
    case 'pen':
    case 'highlight':
      return boundsOfPoints(o.points);
    case 'text':
      return textBounds(o);
    case 'stamp':
      return { x: o.center.x - o.radius, y: o.center.y - o.radius, w: o.radius * 2, h: o.radius * 2 };
  }
}

export const highlightWidth = (size: number): number => strokePx(size) * 3 + 8;

/** True if the point (doc space) hits the object, with tolerance `tol` doc units. */
export function hitObject(o: SkObject, p: Pt, tol: number): boolean {
  if (o.hidden) return false;
  switch (o.type) {
    case 'image':
    case 'pixelate':
      return containsPt(objectFrame(o), p, tol * 0.25);
    case 'stamp':
      return Math.hypot(p.x - o.center.x, p.y - o.center.y) <= o.radius + tol * 0.25;
    case 'text':
      return containsPt(textBounds(o), p, tol * 0.5);
    case 'shape': {
      const r = normRect(o.rect);
      const s = strokePx(o.size) / 2 + tol;
      if (o.shape === 'ellipse') return ellipseEdgeDistance(p, r) <= s;
      return rectEdgeDistance(p, r) <= s;
    }
    case 'arrow': {
      const s = strokePx(o.size) * 1.5 + tol;
      return distToSegment(p, o.from, o.to) <= s;
    }
    case 'line':
      return distToSegment(p, o.from, o.to) <= strokePx(o.size) / 2 + tol;
    case 'pen':
      return distToPolyline(p, o.points) <= strokePx(o.size) / 2 + tol;
    case 'highlight':
      return distToPolyline(p, o.points) <= highlightWidth(o.size) / 2 + tol;
  }
}

/** Returns a translated copy (pure). */
export function translated<T extends SkObject>(o: T, dx: number, dy: number): T {
  const mv = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  switch (o.type) {
    case 'image':
      return { ...o, x: o.x + dx, y: o.y + dy };
    case 'shape':
    case 'pixelate':
      return { ...o, rect: { ...o.rect, x: o.rect.x + dx, y: o.rect.y + dy } };
    case 'arrow':
    case 'line':
      return { ...o, from: mv(o.from), to: mv(o.to) };
    case 'pen':
    case 'highlight':
      return { ...o, points: o.points.map(mv) };
    case 'text':
      return { ...o, pos: mv(o.pos) };
    case 'stamp':
      return { ...o, center: mv(o.center) };
  }
  return o;
}

/**
 * Maps the object's frame `from` onto rect `to` (used by resize handles and by ScaleDocument).
 * Stroke sizes are left alone here; ScaleDocument rescales them separately.
 */
export function reframed<T extends SkObject>(o: T, from: Rect, to: Rect): T {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const map = (p: Pt): Pt => ({ x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy });
  const mapRect = (r: Rect): Rect => {
    const a = map({ x: r.x, y: r.y });
    return { x: a.x, y: a.y, w: r.w * sx, h: r.h * sy };
  };
  switch (o.type) {
    case 'image': {
      const r = mapRect({ x: o.x, y: o.y, w: o.w, h: o.h });
      return { ...o, ...r };
    }
    case 'shape':
    case 'pixelate':
      return { ...o, rect: mapRect(o.rect) };
    case 'arrow':
    case 'line':
      return { ...o, from: map(o.from), to: map(o.to) };
    case 'pen':
    case 'highlight':
      return { ...o, points: o.points.map(map) };
    case 'text': {
      // Text scales uniformly by the handle (§1.2: size follows the resize handle).
      const k = Math.max(0.05, Math.abs(sy));
      return { ...o, pos: map(o.pos), fontSize: Math.max(6, o.fontSize * k) };
    }
    case 'stamp': {
      const k = Math.max(0.05, Math.min(Math.abs(sx), Math.abs(sy)));
      return { ...o, center: map(o.center), radius: Math.max(6, o.radius * k) };
    }
  }
  return o;
}

/** Objects whose handles are 2 endpoints instead of 8 frame handles. */
export const isEndpointObject = (o: SkObject): o is Extract<SkObject, { type: 'arrow' | 'line' }> =>
  o.type === 'arrow' || o.type === 'line';

export const hasColor = (o: SkObject): o is Exclude<SkObject, { type: 'image' | 'pixelate' }> =>
  o.type !== 'image' && o.type !== 'pixelate';

export const hasSize = (o: SkObject): o is Extract<SkObject, { size: number }> => 'size' in o;
