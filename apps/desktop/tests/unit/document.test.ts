import { describe, expect, it } from 'vitest';
import { History } from '../../src/model/commands/history';
import {
  addObjects,
  boundsOf,
  duplicate,
  extendCanvasToFit,
  extendedCanvas,
  moveObjects,
  newDocument,
  placeNewImage,
  removeObjects,
  reorder,
  scaleDocument,
  setCanvas,
} from '../../src/model/commands/document';
import { anchoredRect } from '../../src/model/geometry';
import type { Document, ShapeObject, SkObject } from '../../src/model/types';
import { hitObject, objectBounds, translated } from '../../src/model/objects';

const shape = (id: string, x: number, y: number, w = 50, h = 40): ShapeObject => ({
  id,
  type: 'shape',
  shape: 'rect',
  rect: { x, y, w, h },
  color: '#ff2f92',
  size: 3,
});

const doc = (objects: SkObject[] = []): Document =>
  newDocument({ canvas: { x: 0, y: 0, w: 400, h: 300 }, objects });

describe('document commands', () => {
  it('adds and removes objects with undo', () => {
    const h = new History(doc());
    h.execute(addObjects([shape('a', 10, 10)]));
    expect(h.state.objects).toHaveLength(1);
    h.execute(removeObjects(['a']));
    expect(h.state.objects).toHaveLength(0);
    h.undo();
    expect(h.state.objects[0].id).toBe('a');
  });

  it('extends the canvas to include a dragged object; one undo step restores both', () => {
    const h = new History(doc([shape('a', 10, 10)]));
    h.execute(moveObjects(['a'], 400, 0, 'drag'));
    h.execute(extendCanvasToFit(['a'], 'drag'));
    h.seal();
    const b = boundsOf(h.state, ['a'])!;
    expect(h.state.canvas.x).toBe(0);
    expect(h.state.canvas.x + h.state.canvas.w).toBeGreaterThanOrEqual(b.x + b.w);
    expect(h.state.canvas.h).toBe(300);
    h.undo();
    expect(h.state.canvas).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect((h.state.objects[0] as ShapeObject).rect.x).toBe(10);
  });

  it('extension may move the origin negative without translating objects', () => {
    const h = new History(doc([shape('a', 10, 10)]));
    h.execute(moveObjects(['a'], -100, -100));
    h.execute(extendCanvasToFit(['a']));
    expect(h.state.canvas.x).toBeLessThan(0);
    expect(h.state.canvas.y).toBeLessThan(0);
    expect((h.state.objects[0] as ShapeObject).rect.x).toBe(-90);
  });

  it('extendedCanvas never shrinks and is identity when contained', () => {
    const c = { x: 0, y: 0, w: 100, h: 100 };
    expect(extendedCanvas(c, { x: 10, y: 10, w: 10, h: 10 })).toBe(c);
    expect(extendedCanvas(c, { x: 90, y: 10, w: 20.5, h: 10 })).toEqual({ x: 0, y: 0, w: 111, h: 100 });
  });

  it('crop is non-destructive and can grow the canvas', () => {
    const h = new History(doc([shape('a', 10, 10)]));
    h.execute(setCanvas({ x: -50, y: -20, w: 600, h: 400 }));
    expect(h.state.canvas).toEqual({ x: -50, y: -20, w: 600, h: 400 });
    h.execute(setCanvas({ x: 100, y: 100, w: 10, h: 10 }));
    expect(h.state.objects).toHaveLength(1);
  });

  it('reorders z', () => {
    const h = new History(doc([shape('a', 0, 0), shape('b', 0, 0), shape('c', 0, 0)]));
    const ids = () => h.state.objects.map((o) => o.id).join('');
    h.execute(reorder(['a'], 'forward'));
    expect(ids()).toBe('bac');
    h.execute(reorder(['a'], 'front'));
    expect(ids()).toBe('bca');
    h.execute(reorder(['a'], 'back'));
    expect(ids()).toBe('abc');
    h.execute(reorder(['c'], 'backward'));
    expect(ids()).toBe('acb');
  });

  it('duplicates with offset and new ids', () => {
    const d = doc([shape('a', 0, 0)]);
    const h = new History(d);
    const { cmd, newIds } = duplicate(d, ['a']);
    h.execute(cmd);
    expect(h.state.objects).toHaveLength(2);
    expect(newIds[0]).not.toBe('a');
    expect((h.state.objects[1] as ShapeObject).rect.x).toBe(16);
  });

  it('scales the whole document including canvas and stroke steps', () => {
    const h = new History(doc([shape('a', 10, 20, 100, 50)]));
    h.execute(scaleDocument(2));
    const s = h.state.objects[0] as ShapeObject;
    expect(s.rect).toEqual({ x: 20, y: 40, w: 200, h: 100 });
    expect(h.state.canvas).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(s.size).toBe(4); // step 3 = 6px, x2 = 12px, nearest step is 10px (step 4)
  });

  it('places added images centred, cascading when they would occlude content', () => {
    const canvas = { x: 0, y: 0, w: 400, h: 300 };
    expect(placeNewImage(canvas, { x: 200, y: 150 }, 100, 100, [])).toEqual({ x: 150, y: 100 });
    const occluded = placeNewImage(canvas, { x: 200, y: 150 }, 100, 100, [{ x: 160, y: 110, w: 10, h: 10 }]);
    expect(occluded).toEqual({ x: 174, y: 124 });
    expect(placeNewImage(canvas, { x: 200, y: 150 }, 500, 100, [])).toEqual({ x: 0, y: 0 });
  });

  it('anchors canvas resize on a 3x3 grid', () => {
    const c = { x: 0, y: 0, w: 100, h: 100 };
    expect(anchoredRect(c, 200, 200, 0)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(anchoredRect(c, 200, 200, 4)).toEqual({ x: -50, y: -50, w: 200, h: 200 });
    expect(anchoredRect(c, 200, 200, 8)).toEqual({ x: -100, y: -100, w: 200, h: 200 });
  });
});

describe('objects', () => {
  it('hit-tests shape edges with tolerance, not interiors', () => {
    const s = shape('a', 0, 0, 100, 100);
    expect(hitObject(s, { x: 0, y: 50 }, 8)).toBe(true);
    expect(hitObject(s, { x: 50, y: 50 }, 8)).toBe(false);
  });

  it('hit-tests arrows along the shaft', () => {
    const a: SkObject = {
      id: 'x',
      type: 'arrow',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      color: '#f00',
      size: 3,
    };
    expect(hitObject(a, { x: 50, y: 4 }, 8)).toBe(true);
    expect(hitObject(a, { x: 50, y: 40 }, 8)).toBe(false);
  });

  it('translates every object type', () => {
    const objs: SkObject[] = [
      {
        id: '1',
        type: 'pen',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        color: '#000',
        size: 1,
      },
      { id: '2', type: 'stamp', glyph: 'check', center: { x: 5, y: 5 }, radius: 10, color: '#000' },
      { id: '3', type: 'text', pos: { x: 0, y: 0 }, text: 'hi', color: '#000', fontSize: 20 },
    ];
    for (const o of objs) {
      const b0 = objectBounds(o);
      const b1 = objectBounds(translated(o, 10, -5));
      expect(b1.x - b0.x).toBeCloseTo(10);
      expect(b1.y - b0.y).toBeCloseTo(-5);
    }
  });
});
