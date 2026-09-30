import { isEndpointObject, objectFrame } from '../model/objects';
import type { Pt, Rect, SkObject } from '../model/types';

/** Handle ids: frame handles by compass position, or endpoints for arrows/lines. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'from' | 'to';

export const HANDLE_RADIUS = 5; // screen px
export const HANDLE_HIT = 9; // screen px

export function frameHandles(r: Rect, cornersOnly = false): Array<{ id: HandleId; p: Pt }> {
  const { x, y, w, h } = r;
  const corners: Array<{ id: HandleId; p: Pt }> = [
    { id: 'nw', p: { x, y } },
    { id: 'ne', p: { x: x + w, y } },
    { id: 'se', p: { x: x + w, y: y + h } },
    { id: 'sw', p: { x, y: y + h } },
  ];
  if (cornersOnly) return corners;
  return [
    ...corners,
    { id: 'n', p: { x: x + w / 2, y } },
    { id: 'e', p: { x: x + w, y: y + h / 2 } },
    { id: 's', p: { x: x + w / 2, y: y + h } },
    { id: 'w', p: { x, y: y + h / 2 } },
  ];
}

/** Uniform-scale objects get corner handles only. */
export const cornersOnly = (o: SkObject) => o.type === 'text' || o.type === 'stamp' || o.type === 'image';

export function objectHandles(o: SkObject): Array<{ id: HandleId; p: Pt }> {
  if (isEndpointObject(o))
    return [
      { id: 'from', p: o.from },
      { id: 'to', p: o.to },
    ];
  return frameHandles(objectFrame(o), cornersOnly(o));
}

/**
 * New frame when dragging handle `h` of `start` to doc point `p`.
 * `uniform` keeps the aspect ratio (corners only); `fromCenter` scales about the centre.
 */
export function dragFrame(start: Rect, h: HandleId, p: Pt, uniform: boolean, fromCenter: boolean): Rect {
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (h.includes('w')) x0 = p.x;
  if (h.includes('e')) x1 = p.x;
  if (h === 'n' || h === 'nw' || h === 'ne') y0 = p.y;
  if (h === 's' || h === 'sw' || h === 'se') y1 = p.y;
  if (fromCenter) {
    if (h.includes('w')) x1 = 2 * cx - x0;
    if (h.includes('e')) x0 = 2 * cx - x1;
    if (h === 'n' || h === 'nw' || h === 'ne') y1 = 2 * cy - y0;
    if (h === 's' || h === 'sw' || h === 'se') y0 = 2 * cy - y1;
  }
  let r: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (uniform && h.length === 2 && start.w > 0 && start.h > 0) {
    const k = Math.max(Math.abs(r.w) / start.w, Math.abs(r.h) / start.h);
    const w = start.w * k * Math.sign(r.w || 1);
    const hh = start.h * k * Math.sign(r.h || 1);
    const ax = fromCenter ? cx : h.includes('w') ? start.x + start.w : start.x;
    const ay = fromCenter ? cy : h.startsWith('n') ? start.y + start.h : start.y;
    if (fromCenter) r = { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
    else r = { x: h.includes('w') ? ax - w : ax, y: h.startsWith('n') ? ay - hh : ay, w, h: hh };
  }
  // keep a minimum size, never flip through zero for simplicity
  if (Math.abs(r.w) < 2) r.w = 2 * Math.sign(r.w || 1);
  if (Math.abs(r.h) < 2) r.h = 2 * Math.sign(r.h || 1);
  return r.w < 0 || r.h < 0
    ? { x: r.w < 0 ? r.x + r.w : r.x, y: r.h < 0 ? r.y + r.h : r.y, w: Math.abs(r.w), h: Math.abs(r.h) }
    : r;
}

export const handleCursor = (h: HandleId): string =>
  h === 'n' || h === 's'
    ? 'ns-resize'
    : h === 'e' || h === 'w'
      ? 'ew-resize'
      : h === 'nw' || h === 'se'
        ? 'nwse-resize'
        : h === 'ne' || h === 'sw'
          ? 'nesw-resize'
          : 'crosshair';
