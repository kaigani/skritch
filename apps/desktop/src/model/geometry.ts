import type { Pt, Rect } from './types';

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** Normalises a rect so w/h are non-negative. */
export function normRect(r: Rect): Rect {
  const x = r.w < 0 ? r.x + r.w : r.x;
  const y = r.h < 0 ? r.y + r.h : r.y;
  return { x, y, w: Math.abs(r.w), h: Math.abs(r.h) };
}

export function rectFromPoints(a: Pt, b: Pt): Rect {
  return normRect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
}

export function union(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function containsPt(r: Rect, p: Pt, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function boundsOfPoints(pts: Pt[]): Rect {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Distance from point p to the segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Pt, pts: Pt[]): number {
  if (pts.length === 1) return dist(p, pts[0]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/** Point-in-ellipse test for the ellipse inscribed in r, with a tolerance band. */
export function ellipseEdgeDistance(p: Pt, r: Rect): number {
  const rx = r.w / 2;
  const ry = r.h / 2;
  if (rx === 0 || ry === 0) return Infinity;
  const cx = r.x + rx;
  const cy = r.y + ry;
  const nx = (p.x - cx) / rx;
  const ny = (p.y - cy) / ry;
  const k = Math.hypot(nx, ny);
  // approximate radial distance to the ellipse edge
  return Math.abs(k - 1) * Math.min(rx, ry);
}

export function rectEdgeDistance(p: Pt, r: Rect): number {
  const a = { x: r.x, y: r.y };
  const b = { x: r.x + r.w, y: r.y };
  const c = { x: r.x + r.w, y: r.y + r.h };
  const d = { x: r.x, y: r.y + r.h };
  return Math.min(
    distToSegment(p, a, b),
    distToSegment(p, b, c),
    distToSegment(p, c, d),
    distToSegment(p, d, a),
  );
}

export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const rectEq = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** 3×3 anchor grid position (0..8, row-major) → anchored rect for the Canvas sub-mode (§5.3). */
export function anchoredRect(canvas: Rect, w: number, h: number, anchor: number): Rect {
  const ax = anchor % 3; // 0 left, 1 centre, 2 right
  const ay = Math.floor(anchor / 3);
  const dx = canvas.w - w;
  const dy = canvas.h - h;
  return {
    x: Math.round(canvas.x + (dx * ax) / 2),
    y: Math.round(canvas.y + (dy * ay) / 2),
    w,
    h,
  };
}
