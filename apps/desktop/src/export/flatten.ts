// §4.4 flatten(doc) → encoded bytes. Renders every object to an off-screen canvas of canvas.w × canvas.h,
// translated by -canvas.x, -canvas.y, respecting the background.
import { paintObject, type PaintEnv } from '../canvas/paint';
import type { Document } from '../model/types';
import { SKRITCH_KEY, writeITXt } from './png-metadata';
import { serializeDocument } from './serialize';
import { canvasToBytes, context2d, makeCanvas, type AnyCanvas } from '../util/canvas';

export interface FlattenOptions {
  /** Composite over white when background is transparent (JPG/BMP/GIF). */
  opaque?: boolean;
  scale?: number;
}

export function flattenToCanvas(
  doc: Document,
  bitmap: PaintEnv['bitmap'],
  opts: FlattenOptions = {},
): AnyCanvas {
  const scale = opts.scale ?? 1;
  const { canvas: c } = doc;
  const out = makeCanvas(Math.max(1, Math.round(c.w * scale)), Math.max(1, Math.round(c.h * scale)));
  const g = context2d(out);
  if (doc.background.kind === 'color') {
    g.fillStyle = doc.background.color;
    g.fillRect(0, 0, out.width, out.height);
  } else if (opts.opaque) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
  }
  g.setTransform(scale, 0, 0, scale, -c.x * scale, -c.y * scale);
  const env: PaintEnv = { bitmap, canvasMinSide: Math.min(c.w, c.h) };
  for (const o of doc.objects) paintObject(g, o, env);
  return out;
}

export async function flattenPng(
  doc: Document,
  bitmap: PaintEnv['bitmap'],
  opts: { embedDocument?: boolean } = {},
): Promise<Uint8Array> {
  const png = await canvasToBytes(flattenToCanvas(doc, bitmap));
  if (opts.embedDocument === false) return png;
  return writeITXt(png, SKRITCH_KEY, serializeDocument(doc));
}

export async function flattenJpeg(
  doc: Document,
  bitmap: PaintEnv['bitmap'],
  quality = 0.9,
): Promise<Uint8Array> {
  return canvasToBytes(flattenToCanvas(doc, bitmap, { opaque: true }), 'image/jpeg', quality);
}
