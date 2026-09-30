import { dist } from '../model/geometry';
import { hitObject } from '../model/objects';
import type { Document, Pt, SkObject } from '../model/types';
import { HANDLE_HIT, objectHandles, type HandleId } from './handles';
import type { Renderer } from './Renderer';

/** Top-down hit test; handles are tested before objects by the caller. */
export function hitTop(
  doc: Document,
  p: Pt,
  tolDoc: number,
  filter?: (o: SkObject) => boolean,
): SkObject | null {
  for (let i = doc.objects.length - 1; i >= 0; i--) {
    const o = doc.objects[i];
    if (o.locked || o.hidden) continue;
    if (filter && !filter(o)) continue;
    if (hitObject(o, p, tolDoc)) return o;
  }
  return null;
}

/** Handle of the single selected object under the screen point, if any. */
export function hitHandle(
  r: Renderer,
  doc: Document,
  selection: string[],
  screen: Pt,
): { obj: SkObject; handle: HandleId } | null {
  if (selection.length !== 1) return null;
  const obj = doc.objects.find((o) => o.id === selection[0]);
  if (!obj) return null;
  for (const h of objectHandles(obj))
    if (dist(r.toScreen(h.p), screen) <= HANDLE_HIT) return { obj, handle: h.id };
  return null;
}
