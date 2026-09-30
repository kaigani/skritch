import type { Draft } from 'immer';
import { nanoid } from 'nanoid';
import { union, containsRect, intersect, rectEq } from '../geometry';
import { objectBounds, translated, reframed, hasSize } from '../objects';
import type { Asset, Background, Document, Id, ImageObject, Rect, SkObject } from '../types';
import { STROKE_STEPS } from '../types';
import type { Command } from './history';

export const newId = (): Id => nanoid(10);

export function newDocument(init: Partial<Document> & { canvas: Rect }): Document {
  return {
    id: newId(),
    version: 1,
    background: { kind: 'color', color: '#ffffff' },
    objects: [],
    assets: {},
    meta: { title: 'Untitled', createdAt: new Date().toISOString(), source: 'blank' },
    ...init,
  };
}

/** A document holding a single base image, canvas = image bounds (M1). */
export function documentFromImage(
  asset: Asset,
  meta: Partial<Document['meta']> & { source: Document['meta']['source'] },
): Document {
  const img: ImageObject = {
    id: newId(),
    type: 'image',
    assetId: asset.id,
    x: 0,
    y: 0,
    w: asset.width,
    h: asset.height,
    opacity: 1,
  };
  return newDocument({
    canvas: { x: 0, y: 0, w: asset.width, h: asset.height },
    objects: [img],
    assets: { [asset.id]: asset },
    meta: { title: 'Untitled', createdAt: new Date().toISOString(), ...meta },
  });
}

type Cmd = Command<Document>;
type D = Draft<Document>;

const findIdx = (d: D, id: Id) => d.objects.findIndex((o) => o.id === id);

export const renameDocument = (title: string): Cmd => ({
  name: 'Rename',
  apply: (d) => {
    d.meta.title = title;
  },
});

export const addObjects = (objs: SkObject[], assets: Asset[] = []): Cmd => ({
  name: objs.length === 1 ? `Add ${objs[0].type}` : 'Add objects',
  apply: (d) => {
    for (const a of assets) (d.assets as any)[a.id] = a;
    for (const o of objs) d.objects.push(o as any);
  },
});

export const removeObjects = (ids: Id[]): Cmd => ({
  name: 'Delete',
  apply: (d) => {
    const set = new Set(ids);
    d.objects = d.objects.filter((o) => !set.has(o.id));
    pruneAssets(d);
  },
});

function pruneAssets(d: D): void {
  const used = new Set(d.objects.filter((o) => o.type === 'image').map((o) => (o as ImageObject).assetId));
  for (const k of Object.keys(d.assets)) if (!used.has(k)) delete d.assets[k];
}

/** Replaces objects by id with new values (used for property edits and live drags). */
export const replaceObjects = (objs: SkObject[], name = 'Edit', coalesceKey?: string): Cmd => ({
  name,
  coalesceKey,
  apply: (d) => {
    for (const o of objs) {
      const i = findIdx(d, o.id);
      if (i >= 0) d.objects[i] = o as any;
    }
  },
});

export const updateObjects = (
  ids: Id[],
  patch: (o: SkObject) => SkObject,
  name = 'Edit',
  coalesceKey?: string,
): Cmd => ({
  name,
  coalesceKey,
  apply: (d) => {
    for (const id of ids) {
      const i = findIdx(d, id);
      if (i >= 0) d.objects[i] = patch(d.objects[i] as SkObject) as any;
    }
  },
});

export const moveObjects = (ids: Id[], dx: number, dy: number, coalesceKey?: string): Cmd =>
  updateObjects(ids, (o) => translated(o, dx, dy), 'Move', coalesceKey);

export const resizeObject = (id: Id, from: Rect, to: Rect, coalesceKey?: string): Cmd =>
  updateObjects([id], (o) => reframed(o, from, to), 'Resize', coalesceKey);

export const setCanvas = (r: Rect, name = 'Crop'): Cmd => ({
  name,
  apply: (d) => {
    d.canvas = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.max(1, Math.round(r.w)),
      h: Math.max(1, Math.round(r.h)),
    };
  },
});

/** Map a visible document rectangle back into the original bitmap, including earlier crops. */
function trimImage(image: Draft<ImageObject>, asset: Draft<Asset>, r: Rect): void {
  if (rectEq(image, r)) return;
  const s = image.sourceRect ?? { x: 0, y: 0, w: asset.width, h: asset.height };
  image.sourceRect = {
    x: s.x + ((r.x - image.x) * s.w) / image.w,
    y: s.y + ((r.y - image.y) * s.h) / image.h,
    w: (r.w * s.w) / image.w,
    h: (r.h * s.h) / image.h,
  };
  Object.assign(image, r);
}

/** Crop the canvas and its image layers together, including hidden/locked images. */
export const cropCanvas = (rect: Rect, name = 'Crop'): Cmd => ({
  name,
  apply: (d) => {
    if (!rectEq(d.canvas, rect)) setCanvas(rect).apply(d);
    for (let i = d.objects.length - 1; i >= 0; i--) {
      const image = d.objects[i];
      if (image.type !== 'image') continue;
      const r = intersect(image, d.canvas);
      if (!r) {
        d.objects.splice(i, 1);
      } else {
        const asset = d.assets[image.assetId];
        if (asset) trimImage(image, asset, r);
      }
    }
    pruneAssets(d);
  },
});

/** Crop one image without changing the canvas, sibling layers, or original asset bytes. */
export const cropImage = (id: Id, rect: Rect): Cmd => ({
  name: 'Crop image',
  apply: (d) => {
    const image = d.objects.find((o) => o.id === id);
    if (!image || image.type !== 'image' || image.locked) return;
    const asset = d.assets[image.assetId];
    const r = intersect(image, rect);
    if (!asset || !r) return;
    trimImage(image, asset, r);
  },
});

/** Union of the objects' visual bounds (null if none). */
export function boundsOf(doc: Document, ids: Id[]): Rect | null {
  let r: Rect | null = null;
  for (const o of doc.objects) if (ids.includes(o.id)) r = r ? union(r, objectBounds(o)) : objectBounds(o);
  return r;
}

/**
 * §5.2: newRect = union(canvas, objectBounds). Objects are NOT translated; the canvas origin may go
 * negative. Never shrinks. Rounded outward to whole pixels.
 */
export function extendedCanvas(canvas: Rect, bounds: Rect): Rect {
  if (containsRect(canvas, bounds)) return canvas;
  const u = union(canvas, bounds);
  const x0 = Math.floor(u.x);
  const y0 = Math.floor(u.y);
  return { x: x0, y: y0, w: Math.ceil(u.x + u.w) - x0, h: Math.ceil(u.y + u.h) - y0 };
}

export const extendCanvasToFit = (ids: Id[], coalesceKey?: string): Cmd => ({
  name: 'Extend canvas',
  coalesceKey,
  apply: (d) => {
    const b = boundsOf(d as Document, ids);
    if (!b) return;
    const next = extendedCanvas(d.canvas, b);
    if (next !== d.canvas) d.canvas = next;
  },
});

export type ZOrder = 'forward' | 'backward' | 'front' | 'back';

export const reorder = (ids: Id[], dir: ZOrder): Cmd => ({
  name:
    dir === 'front'
      ? 'Bring to Front'
      : dir === 'back'
        ? 'Send to Back'
        : dir === 'forward'
          ? 'Bring Forward'
          : 'Send Backward',
  apply: (d) => {
    const set = new Set(ids);
    const objs = d.objects.slice() as SkObject[];
    if (dir === 'front') {
      d.objects = [...objs.filter((o) => !set.has(o.id)), ...objs.filter((o) => set.has(o.id))] as any;
    } else if (dir === 'back') {
      d.objects = [...objs.filter((o) => set.has(o.id)), ...objs.filter((o) => !set.has(o.id))] as any;
    } else if (dir === 'forward') {
      for (let i = objs.length - 2; i >= 0; i--)
        if (set.has(objs[i].id) && !set.has(objs[i + 1].id)) [objs[i], objs[i + 1]] = [objs[i + 1], objs[i]];
      d.objects = objs as any;
    } else {
      for (let i = 1; i < objs.length; i++)
        if (set.has(objs[i].id) && !set.has(objs[i - 1].id)) [objs[i], objs[i - 1]] = [objs[i - 1], objs[i]];
      d.objects = objs as any;
    }
  },
});

/** Duplicates objects offset by +16,+16; returns the command and the new ids. */
export function duplicate(doc: Document, ids: Id[]): { cmd: Cmd; newIds: Id[] } {
  const src = doc.objects.filter((o) => ids.includes(o.id));
  const copies = src.map((o) => ({ ...translated(o, 16, 16), id: newId() }));
  return { cmd: { ...addObjects(copies), name: 'Duplicate' }, newIds: copies.map((c) => c.id) };
}

/** Nearest stroke step for a scaled pixel width. */
function nearestStep(px: number): number {
  let best = 0;
  for (let i = 1; i < STROKE_STEPS.length; i++)
    if (Math.abs(STROKE_STEPS[i] - px) < Math.abs(STROKE_STEPS[best] - px)) best = i;
  return best + 1;
}

/**
 * §5.3 Scale: multiplies every object's geometry, font sizes and stroke sizes (rounded to the
 * nearest step). Image assets keep the original bitmap; only w/h change.
 */
export const scaleDocument = (factor: number): Cmd => ({
  name: 'Scale',
  apply: (d) => {
    const c = d.canvas;
    const from = { x: 0, y: 0, w: 1, h: 1 };
    const to = { x: 0, y: 0, w: factor, h: factor };
    d.objects = (d.objects as SkObject[]).map((o) => {
      let n = reframed(o, from, to); // also scales font sizes and stamp radii
      if (hasSize(n)) n = { ...n, size: nearestStep(STROKE_STEPS[n.size - 1] * factor) } as SkObject;
      return n;
    }) as any;
    d.canvas = {
      x: Math.round(c.x * factor),
      y: Math.round(c.y * factor),
      w: Math.max(1, Math.round(c.w * factor)),
      h: Math.max(1, Math.round(c.h * factor)),
    };
  },
});

export const setBackground = (bg: Background): Cmd => ({
  name: 'Background',
  apply: (d) => {
    d.background = bg;
  },
});

/**
 * §5.1 Add to Canvas placement: centred in the viewport; cascade +24 if it would fully occlude
 * existing content; if larger than the canvas, place at the canvas origin (caller then extends).
 */
export function placeNewImage(
  canvas: Rect,
  viewportCenter: { x: number; y: number },
  w: number,
  h: number,
  existing: Rect[],
  cascadeIndex = 0,
): { x: number; y: number } {
  if (w > canvas.w || h > canvas.h)
    return { x: canvas.x + cascadeIndex * 24, y: canvas.y + cascadeIndex * 24 };
  const x = Math.round(viewportCenter.x - w / 2) + cascadeIndex * 24;
  const y = Math.round(viewportCenter.y - h / 2) + cascadeIndex * 24;
  const content = existing.length ? existing.reduce(union) : null;
  const occludes = content !== null && containsRect({ x, y, w, h }, content);
  return occludes ? { x: x + 24, y: y + 24 } : { x, y };
}
