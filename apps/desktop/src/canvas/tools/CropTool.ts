import { cropCanvas, cropImage, scaleDocument } from '../../model/commands/document';
import { containsPt, dist, rectFromPoints, intersect } from '../../model/geometry';
import type { Document, ImageObject, Pt, Rect } from '../../model/types';
import { docState } from '../../state/document';
import { ui, useUi, type CropState } from '../../state/ui';
import { dragFrame, frameHandles, handleCursor, HANDLE_HIT, HANDLE_RADIUS, type HandleId } from '../handles';
import type { Renderer } from '../Renderer';
import type { PointerInfo, Tool } from './Tool';

type Drag =
  | { kind: 'handle'; h: HandleId; start: Rect }
  | { kind: 'move'; at: Pt; start: Rect }
  | { kind: 'new'; at: Pt };

/**
 * Crop the selected image on multi-image documents, or the canvas. Click the backdrop to target
 * the canvas; canvas handles can grow it. Image crops retain the original bitmap and undo history.
 */
export class CropTool implements Tool {
  cursor = 'crosshair';
  private drag: Drag | null = null;

  constructor(private r: Renderer) {
    const doc = docState().doc;
    if (doc && !ui().crop) {
      const images = doc.objects.filter(
        (o): o is ImageObject => o.type === 'image' && !o.hidden && !o.locked,
      );
      const image =
        images.length > 1
          ? (images.find((o) => docState().selection.includes(o.id)) ?? images[images.length - 1])
          : undefined;
      useUi.setState({
        crop: {
          targetId: image?.id ?? null,
          mode: 'crop',
          rect: image ? { x: image.x, y: image.y, w: image.w, h: image.h } : { ...doc.canvas },
          lockRatio: false,
          anchor: 4,
          scalePct: 100,
        },
      });
    }
  }

  private get crop(): CropState | null {
    return ui().crop;
  }

  private setRect(rect: Rect): void {
    const c = this.crop;
    if (!c) return;
    let r = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(1, Math.round(rect.w)),
      h: Math.max(1, Math.round(rect.h)),
    };
    if (c.targetId) {
      const image = docState().doc?.objects.find(
        (o): o is ImageObject => o.id === c.targetId && o.type === 'image',
      );
      if (!image) return;
      const clipped = intersect(r, image);
      if (!clipped || clipped.w < 1 || clipped.h < 1) return;
      r = clipped;
    }
    useUi.setState({ crop: { ...c, rect: r } });
  }

  private handleAt(screen: Pt): HandleId | null {
    const c = this.crop;
    if (!c || c.mode === 'scale') return null;
    for (const h of frameHandles(c.rect))
      if (dist(this.r.toScreen(h.p), screen) <= HANDLE_HIT + 2) return h.id;
    return null;
  }

  onDown(p: PointerInfo): void {
    let c = this.crop;
    const doc = docState().doc;
    if (!c || !doc || c.mode === 'scale') return;
    const h = this.handleAt(p.screen);
    // Existing handles win at an edge, so canvas growing remains possible.
    if (h && (!c.targetId || containsPt(doc.canvas, p.doc))) {
      this.drag = { kind: 'handle', h, start: c.rect };
      return;
    }
    if (!containsPt(doc.canvas, p.doc)) {
      useUi.setState({ crop: { ...c, targetId: null, rect: { ...doc.canvas } } });
      this.drag = null;
      return;
    }
    if (c.mode === 'crop') {
      const images = doc.objects.filter(
        (o): o is ImageObject => o.type === 'image' && !o.hidden && !o.locked,
      );
      const image = images.length > 1 ? [...images].reverse().find((o) => containsPt(o, p.doc)) : undefined;
      if (image && image.id !== c.targetId) {
        c = { ...c, targetId: image.id, rect: { x: image.x, y: image.y, w: image.w, h: image.h } };
        useUi.setState({ crop: c });
        docState().select([image.id]);
        this.drag = null;
        return;
      }
    }
    if (containsPt(c.rect, p.doc)) this.drag = { kind: 'move', at: p.doc, start: c.rect };
    else this.drag = { kind: 'new', at: p.doc };
  }

  onMove(p: PointerInfo): void {
    const d = this.drag;
    const c = this.crop;
    if (!d || !c) return;
    if (d.kind === 'handle') this.setRect(dragFrame(d.start, d.h, p.doc, c.lockRatio || p.shift, p.alt));
    else if (d.kind === 'move')
      this.setRect({ ...d.start, x: d.start.x + p.doc.x - d.at.x, y: d.start.y + p.doc.y - d.at.y });
    else this.setRect(rectFromPoints(d.at, p.doc));
  }

  onUp(): void {
    this.drag = null;
  }

  hoverCursor(p: PointerInfo): string {
    const h = this.handleAt(p.screen);
    if (h) return handleCursor(h);
    const c = this.crop;
    return c && containsPt(c.rect, p.doc) ? 'move' : this.cursor;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') {
      applyCrop();
      return true;
    }
    if (e.key === 'Escape') {
      cancelCrop();
      return true;
    }
    return false;
  }

  renderOverlay(g: CanvasRenderingContext2D, doc: Document): void {
    const c = this.crop;
    if (!c || c.mode === 'scale') return;
    const r = this.r.screenRect(c.rect);
    // content outside the proposed canvas dimmed to 40 %
    g.save();
    g.fillStyle = 'rgba(80,80,80,0.6)';
    g.beginPath();
    g.rect(0, 0, this.r.cssW, this.r.cssH);
    g.rect(r.x, r.y, r.w, r.h);
    g.fill('evenodd');
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    g.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    g.setLineDash([4, 4]);
    g.strokeStyle = '#000';
    g.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    g.setLineDash([]);
    // rule-of-thirds guides
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      g.moveTo(r.x + r.w * k, r.y);
      g.lineTo(r.x + r.w * k, r.y + r.h);
      g.moveTo(r.x, r.y + r.h * k);
      g.lineTo(r.x + r.w, r.y + r.h * k);
    }
    g.stroke();
    // original canvas outline, so growing is visible
    const oc = this.r.screenRect(doc.canvas);
    g.setLineDash([3, 3]);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.strokeRect(Math.round(oc.x) + 0.5, Math.round(oc.y) + 0.5, Math.round(oc.w), Math.round(oc.h));
    g.setLineDash([]);
    for (const h of frameHandles(r)) {
      g.beginPath();
      g.arc(h.p.x, h.p.y, HANDLE_RADIUS + 1, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.strokeStyle = '#2f8cff';
      g.lineWidth = 1.5;
      g.stroke();
    }
    const label = `${c.targetId ? 'Image' : 'Canvas'} · ${Math.round(c.rect.w)} × ${Math.round(c.rect.h)}`;
    g.font = '600 11px Inter, system-ui, sans-serif';
    const tw = g.measureText(label).width + 12;
    const lx = r.x + r.w / 2 - tw / 2;
    const ly = r.y + r.h + 10;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.beginPath();
    g.roundRect(lx, ly, tw, 20, 10);
    g.fill();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(label, lx + 6, ly + 10);
    g.restore();
  }
}

export function applyCrop(): void {
  const c = ui().crop;
  const doc = docState().doc;
  if (!c || !doc) return;
  if (c.mode === 'scale') {
    if (c.scalePct > 0 && c.scalePct !== 100) docState().execute(scaleDocument(c.scalePct / 100));
  } else if (c.targetId && c.mode === 'crop') {
    docState().execute(cropImage(c.targetId, c.rect));
    docState().seal();
  } else {
    const r = c.rect;
    docState().execute(cropCanvas(r, r.w > doc.canvas.w || r.h > doc.canvas.h ? 'Grow canvas' : 'Crop'));
    docState().seal();
  }
  useUi.setState({ crop: null });
  ui().setTool('select');
}

export function cancelCrop(): void {
  useUi.setState({ crop: null });
  ui().setTool('select');
}
