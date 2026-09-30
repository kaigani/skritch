import type { Pt, Rect } from '../model/types';

export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export type Bounds = { width: number; height: number };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Selection geometry is always in screenshot pixels, including on Retina displays. */
export function screenPoint(p: Pt, bounds: Bounds): Pt {
  return { x: clamp(Math.round(p.x), 0, bounds.width), y: clamp(Math.round(p.y), 0, bounds.height) };
}

export function moveSelection(rect: Rect, delta: Pt, bounds: Bounds): Rect {
  return {
    ...rect,
    x: clamp(Math.round(rect.x + delta.x), 0, bounds.width - rect.w),
    y: clamp(Math.round(rect.y + delta.y), 0, bounds.height - rect.h),
  };
}

/** Keep the opposite corner fixed, with optional aspect ratio and no offscreen pixels. */
export function resizeSelection(rect: Rect, corner: Corner, p: Pt, bounds: Bounds, ratio?: number): Rect {
  const left = corner.includes('w');
  const top = corner.includes('n');
  const anchor = { x: left ? rect.x + rect.w : rect.x, y: top ? rect.y + rect.h : rect.y };
  const maxW = left ? anchor.x : bounds.width - anchor.x;
  const maxH = top ? anchor.y : bounds.height - anchor.y;
  let w = Math.max(1, left ? anchor.x - p.x : p.x - anchor.x);
  let h = Math.max(1, top ? anchor.y - p.y : p.y - anchor.y);
  if (ratio) {
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    const scale = Math.min(1, maxW / w, maxH / h);
    w *= scale;
    h *= scale;
  }
  w = clamp(Math.round(w), 1, maxW);
  h = clamp(Math.round(h), 1, maxH);
  return { x: left ? anchor.x - w : anchor.x, y: top ? anchor.y - h : anchor.y, w, h };
}

export function sizeSelection(
  rect: Rect,
  axis: 'w' | 'h',
  value: number,
  bounds: Bounds,
  ratio?: number,
): Rect {
  if (!Number.isFinite(value) || value < 1) return rect;
  const w = axis === 'w' ? value : ratio ? value * ratio : rect.w;
  const h = axis === 'h' ? value : ratio ? value / ratio : rect.h;
  return resizeSelection(rect, 'se', { x: rect.x + w, y: rect.y + h }, bounds, ratio);
}
