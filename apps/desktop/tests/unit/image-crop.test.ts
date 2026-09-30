import { describe, expect, it } from 'vitest';
import { cropCanvas, cropImage, newDocument, resizeObject } from '../../src/model/commands/document';
import { History } from '../../src/model/commands/history';
import { hydrateDocument, deserializeDocument, serializeDocument } from '../../src/export/serialize';
import type { ImageObject } from '../../src/model/types';

const image: ImageObject = {
  id: 'image',
  type: 'image',
  assetId: 'a',
  x: 20,
  y: 30,
  w: 200,
  h: 100,
  opacity: 1,
};
const make = () =>
  newDocument({
    canvas: { x: 0, y: 0, w: 800, h: 600 },
    objects: [image, { ...image, id: 'other', x: 400 }],
    assets: { a: { id: 'a', mime: 'image/png', width: 400, height: 200, bytes: new Uint8Array([1, 2, 3]) } },
  });

describe('image crop', () => {
  it('crops only the target with original pixels retained, and undo restores it', () => {
    const original = make();
    const h = new History(original);
    h.execute(cropImage('image', { x: 70, y: 50, w: 100, h: 50 }));
    expect(h.state.canvas).toEqual(original.canvas);
    expect(h.state.objects[1]).toEqual(original.objects[1]);
    expect(h.state.objects[0]).toMatchObject({
      x: 70,
      y: 50,
      w: 100,
      h: 50,
      sourceRect: { x: 100, y: 40, w: 200, h: 100 },
    });
    expect(h.state.assets).toEqual(original.assets);
    expect(hydrateDocument(deserializeDocument(serializeDocument(h.state)))).toEqual(h.state);
    h.undo();
    expect(h.state).toEqual(original);
    h.redo();
    expect((h.state.objects[0] as ImageObject).sourceRect?.x).toBe(100);
  });
  it('composes repeated crops after a resize without stretching the source region', () => {
    const h = new History(make());
    h.execute(cropImage('image', { x: 70, y: 50, w: 100, h: 50 }));
    h.execute(resizeObject('image', { x: 70, y: 50, w: 100, h: 50 }, { x: 70, y: 50, w: 200, h: 100 }));
    h.execute(cropImage('image', { x: 120, y: 75, w: 100, h: 50 }));
    expect((h.state.objects[0] as ImageObject).sourceRect).toEqual({ x: 150, y: 65, w: 100, h: 50 });
  });
  it('clips to the layer and ignores empty intersections and locked layers', () => {
    const h = new History(make());
    h.execute(cropImage('image', { x: 0, y: 0, w: 100, h: 100 }));
    expect(h.state.objects[0]).toMatchObject({ x: 20, y: 30, w: 80, h: 70 });
    const before = h.state;
    h.execute(cropImage('image', { x: 500, y: 500, w: 10, h: 10 }));
    expect(h.state).toEqual(before);
    const locked = make();
    locked.objects[0] = { ...image, locked: true };
    const l = new History(locked);
    l.execute(cropImage('image', { x: 30, y: 40, w: 10, h: 10 }));
    expect(l.state).toEqual(locked);
  });
});

describe('canvas crop', () => {
  it('trims all image bounds and source pixels to the canvas in one undoable operation', () => {
    const original = make();
    const h = new History(original);
    h.execute(cropCanvas({ x: 70, y: 50, w: 380, h: 50 }));
    expect(h.state.objects[0]).toMatchObject({
      x: 70,
      y: 50,
      w: 150,
      h: 50,
      sourceRect: { x: 100, y: 40, w: 300, h: 100 },
    });
    expect(h.state.objects[1]).toMatchObject({
      x: 400,
      y: 50,
      w: 50,
      h: 50,
      sourceRect: { x: 0, y: 40, w: 100, h: 100 },
    });
    expect(h.state.assets).toEqual(original.assets);
    const cropped = h.state;
    expect(hydrateDocument(deserializeDocument(serializeDocument(cropped)))).toEqual(cropped);
    h.undo();
    expect(h.state).toEqual(original);
    h.redo();
    expect(h.state).toEqual(cropped);
  });

  it('composes with a resized layer crop and does not restore overhang when the canvas grows', () => {
    const h = new History(make());
    h.execute(cropImage('image', { x: 70, y: 50, w: 100, h: 50 }));
    h.execute(resizeObject('image', { x: 70, y: 50, w: 100, h: 50 }, { x: -30, y: -20, w: 200, h: 100 }));
    h.execute(cropCanvas({ x: -10, y: -10, w: 100, h: 50 }));
    expect(h.state.objects).toHaveLength(1);
    expect(h.state.objects[0]).toMatchObject({
      x: -10,
      y: -10,
      w: 100,
      h: 50,
      sourceRect: { x: 120, y: 50, w: 100, h: 50 },
    });
    const cropped = h.state.objects;
    h.execute(cropCanvas({ x: -50, y: -50, w: 800, h: 600 }));
    expect(h.state.objects).toEqual(cropped);
  });

  it('includes locked and hidden images, removes fully excluded layers, and restores them on undo', () => {
    const original = make();
    original.objects[0] = { ...image, hidden: true, locked: true };
    const h = new History(original);
    h.execute(cropCanvas({ x: 30, y: 40, w: 100, h: 50 }));
    expect(h.state.objects).toHaveLength(1);
    expect(h.state.objects[0]).toMatchObject({ x: 30, y: 40, w: 100, h: 50, hidden: true, locked: true });
    h.undo();
    expect(h.state).toEqual(original);
  });

  it('repairs existing overhang when applying unchanged canvas bounds', () => {
    const original = make();
    original.canvas = { x: 70, y: 50, w: 380, h: 50 };
    const h = new History(original);
    h.execute(cropCanvas(original.canvas));
    expect(h.state.objects[0]).toMatchObject({ x: 70, y: 50, w: 150, h: 50 });
    expect(h.state.objects[1]).toMatchObject({ x: 400, y: 50, w: 50, h: 50 });
    const cropped = h.state;
    h.execute(cropCanvas(original.canvas));
    expect(h.state).toBe(cropped);
  });
});
