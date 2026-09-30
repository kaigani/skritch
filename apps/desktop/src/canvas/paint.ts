// Object painting shared by the on-screen renderer and export/flatten (§1.2, §4.3).
import { arrowPolygon } from '../model/objects/arrow';
import { TEXT_LINE_HEIGHT, highlightWidth, setTextMeasurer } from '../model/objects';
import { normRect } from '../model/geometry';
import type { Pt, Rect, SkObject, StampGlyph } from '../model/types';
import { context2d, makeCanvas } from '../util/canvas';
import { haloPx, strokePx } from '../model/types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type BitmapSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export interface PaintEnv {
  bitmap: (assetId: string) => BitmapSource | undefined;
  /** Shorter canvas side in doc units — pixelate block size derives from it. */
  canvasMinSide: number;
}

export const HALO = 'rgba(255,255,255,0.85)';
export const TEXT_FONT_FAMILY = '"Nunito", "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif';
export const textFont = (size: number) => `800 ${size}px ${TEXT_FONT_FAMILY}`;

// Text measurement for the model (bounding boxes, hit-testing).
const measureCtx = context2d(makeCanvas(1, 1));
setTextMeasurer((text, fontSize) => {
  measureCtx.font = textFont(fontSize);
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => measureCtx.measureText(l).width));
  return {
    w: Math.max(w, fontSize * 0.5) + textHaloWidth(fontSize),
    h: lines.length * fontSize * TEXT_LINE_HEIGHT,
  };
});

export const textHaloWidth = (fontSize: number) => Math.max(3, fontSize * 0.2);

export function paintObject(g: Ctx, o: SkObject, env: PaintEnv): void {
  if (o.hidden) return;
  switch (o.type) {
    case 'image': {
      const bmp = env.bitmap(o.assetId);
      if (!bmp) return;
      g.save();
      g.globalAlpha = o.opacity;
      g.imageSmoothingQuality = 'high';
      if (o.sourceRect) {
        const s = o.sourceRect;
        g.drawImage(bmp, s.x, s.y, s.w, s.h, o.x, o.y, o.w, o.h);
      } else g.drawImage(bmp, o.x, o.y, o.w, o.h);
      g.restore();
      return;
    }
    case 'arrow':
      return paintArrow(g, o.from, o.to, strokePx(o.size), o.color);
    case 'line': {
      const s = strokePx(o.size);
      strokeWithHalo(g, s, o.color, () => {
        g.beginPath();
        g.moveTo(o.from.x, o.from.y);
        g.lineTo(o.to.x, o.to.y);
      });
      return;
    }
    case 'shape': {
      const s = strokePx(o.size);
      const r = normRect(o.rect);
      strokeWithHalo(g, s, o.color, () => shapePath(g, o.shape, r));
      return;
    }
    case 'pen': {
      const s = strokePx(o.size);
      strokeWithHalo(g, s, o.color, () => smoothPath(g, o.points));
      return;
    }
    case 'highlight': {
      g.save();
      g.globalAlpha = 0.5;
      g.globalCompositeOperation = 'multiply';
      g.strokeStyle = o.color;
      g.lineWidth = highlightWidth(o.size);
      g.lineCap = 'square';
      g.lineJoin = 'miter';
      smoothPath(g, o.points);
      g.stroke();
      g.restore();
      return;
    }
    case 'text':
      return paintText(g, o.pos, o.text, o.fontSize, o.color);
    case 'stamp':
      return paintStamp(g, o.center, o.radius, o.glyph, o.color);
    case 'pixelate':
      return paintPixelate(g, normRect(o.rect), o.blockSize ?? pixelBlock(env.canvasMinSide));
  }
}

export const pixelBlock = (minSide: number) => Math.max(6, Math.round(minSide / 40));

function strokeWithHalo(g: Ctx, width: number, color: string, path: () => void): void {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  path();
  g.strokeStyle = HALO;
  g.lineWidth = width + 2 * haloPx(width);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
  g.restore();
}

export function shapePath(g: Ctx, shape: 'rect' | 'roundRect' | 'ellipse', r: Rect): void {
  g.beginPath();
  if (shape === 'ellipse') {
    g.ellipse(
      r.x + r.w / 2,
      r.y + r.h / 2,
      Math.max(0.5, r.w / 2),
      Math.max(0.5, r.h / 2),
      0,
      0,
      Math.PI * 2,
    );
  } else if (shape === 'roundRect') {
    g.roundRect(r.x, r.y, r.w, r.h, Math.min(24, Math.min(r.w, r.h) * 0.18));
  } else {
    g.rect(r.x, r.y, r.w, r.h);
  }
}

/** Catmull-Rom smoothing through the points, emitted as cubic Béziers. */
export function smoothPath(g: Ctx, pts: Pt[]): void {
  g.beginPath();
  if (pts.length === 0) return;
  g.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    g.lineTo(pts[0].x + 0.01, pts[0].y);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    g.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
}

export function paintArrow(g: Ctx, from: Pt, to: Pt, stroke: number, color: string): void {
  const poly = arrowPolygon(from, to, stroke);
  if (poly.length < 3) return;
  g.save();
  g.beginPath();
  g.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = HALO;
  g.lineWidth = 2 * haloPx(stroke);
  g.stroke();
  g.fillStyle = color;
  g.fill();
  g.restore();
}

export function paintText(g: Ctx, pos: Pt, text: string, fontSize: number, color: string): void {
  g.save();
  g.font = textFont(fontSize);
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const halo = textHaloWidth(fontSize);
  const lines = text.split('\n');
  const x = pos.x + halo / 2;
  lines.forEach((line, i) => {
    const y = pos.y + i * fontSize * TEXT_LINE_HEIGHT + fontSize * 0.08;
    g.strokeStyle = HALO;
    g.lineWidth = halo;
    g.strokeText(line, x, y);
    g.fillStyle = color;
    g.fillText(line, x, y);
  });
  g.restore();
}

export function paintStamp(g: Ctx, c: Pt, r: number, glyph: StampGlyph, color: string): void {
  g.save();
  const ring = Math.max(2, r * 0.1);
  g.shadowColor = 'rgba(0,0,0,0.25)';
  g.shadowBlur = r * 0.15;
  g.shadowOffsetY = r * 0.05;
  g.beginPath();
  g.arc(c.x, c.y, r - ring / 2, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = ring;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = r * 0.2;
  const k = r * 0.42;
  g.beginPath();
  switch (glyph) {
    case 'check':
      g.moveTo(c.x - k, c.y + k * 0.05);
      g.lineTo(c.x - k * 0.25, c.y + k * 0.7);
      g.lineTo(c.x + k, c.y - k * 0.6);
      g.stroke();
      break;
    case 'x':
      g.moveTo(c.x - k * 0.75, c.y - k * 0.75);
      g.lineTo(c.x + k * 0.75, c.y + k * 0.75);
      g.moveTo(c.x + k * 0.75, c.y - k * 0.75);
      g.lineTo(c.x - k * 0.75, c.y + k * 0.75);
      g.stroke();
      break;
    case 'heart': {
      const s = k * 1.05;
      g.moveTo(c.x, c.y + s * 0.85);
      g.bezierCurveTo(c.x - s * 1.4, c.y - s * 0.1, c.x - s * 0.7, c.y - s * 1.1, c.x, c.y - s * 0.4);
      g.bezierCurveTo(c.x + s * 0.7, c.y - s * 1.1, c.x + s * 1.4, c.y - s * 0.1, c.x, c.y + s * 0.85);
      g.fill();
      break;
    }
    case 'question':
    case 'exclaim':
      g.font = textFont(r * 1.25);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(glyph === 'question' ? '?' : '!', c.x, c.y + r * 0.06);
      break;
  }
  g.restore();
}

/**
 * Mosaics whatever is already painted beneath `r` on the target (§4.3): reads the device-pixel region
 * back at 1/block scale and draws it upscaled with smoothing disabled.
 */
export function paintPixelate(g: Ctx, r: Rect, block: number): void {
  const m = g.getTransform();
  const dx0 = m.a * r.x + m.e;
  const dy0 = m.d * r.y + m.f;
  const dw = m.a * r.w;
  const dh = m.d * r.h;
  const cw = g.canvas.width;
  const ch = g.canvas.height;
  const x0 = Math.max(0, Math.floor(dx0));
  const y0 = Math.max(0, Math.floor(dy0));
  const x1 = Math.min(cw, Math.ceil(dx0 + dw));
  const y1 = Math.min(ch, Math.ceil(dy0 + dh));
  if (x1 <= x0 || y1 <= y0) return;
  const devBlock = Math.max(1, block * m.a);
  const sw = Math.max(1, Math.round((x1 - x0) / devBlock));
  const sh = Math.max(1, Math.round((y1 - y0) / devBlock));
  const small = makeCanvas(sw, sh);
  const sg = context2d(small);
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = 'medium';
  sg.drawImage(g.canvas as CanvasImageSource, x0, y0, x1 - x0, y1 - y0, 0, 0, sw, sh);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, sw, sh, x0, y0, x1 - x0, y1 - y0);
  g.restore();
}

/** Checkerboard for transparent backgrounds (screen only). */
export function checkerPattern(g: Ctx, size = 8): CanvasPattern | null {
  const c = makeCanvas(size * 2, size * 2);
  const cg = context2d(c);
  cg.fillStyle = '#fff';
  cg.fillRect(0, 0, size * 2, size * 2);
  cg.fillStyle = '#d9d9d9';
  cg.fillRect(0, 0, size, size);
  cg.fillRect(size, size, size, size);
  return g.createPattern(c, 'repeat');
}
