import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { moveSelection, resizeSelection, sizeSelection, type Corner } from '../../src/capture/selection';

const bounds = { width: 1920, height: 1080 };
const rect = { x: 100, y: 80, w: 600, h: 400 };
describe('capture selection', () => {
  it('moves without changing size and stops at display edges', () => {
    expect(moveSelection(rect, { x: -900, y: 2000 }, bounds)).toEqual({ x: 0, y: 680, w: 600, h: 400 });
  });
  it('anchors the opposite corner, including when crossing it', () => {
    expect(resizeSelection(rect, 'nw', { x: 40, y: 20 }, bounds)).toEqual({ x: 40, y: 20, w: 660, h: 460 });
    expect(resizeSelection(rect, 'se', { x: 50, y: 30 }, bounds)).toEqual({ x: 100, y: 80, w: 1, h: 1 });
  });
  it('links pixel dimensions and constrains them to the display', () => {
    expect(sizeSelection(rect, 'w', 900, bounds, 1.5)).toEqual({ x: 100, y: 80, w: 900, h: 600 });
    expect(sizeSelection(rect, 'h', 3000, bounds, 1.5)).toEqual({ x: 100, y: 80, w: 1500, h: 1000 });
    expect(sizeSelection(rect, 'w', NaN, bounds)).toEqual(rect);
  });
  it('keeps every corner within the display and preserves locked proportions to a pixel', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: -5000, max: 5000 }), (x, y) => {
        for (const corner of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
          const result = resizeSelection(rect, corner, { x, y }, bounds, 1.5);
          expect(result.x).toBeGreaterThanOrEqual(0);
          expect(result.y).toBeGreaterThanOrEqual(0);
          expect(result.x + result.w).toBeLessThanOrEqual(bounds.width);
          expect(result.y + result.h).toBeLessThanOrEqual(bounds.height);
          expect(result.w).toBeGreaterThanOrEqual(1);
          expect(result.h).toBeGreaterThanOrEqual(1);
          expect(Math.abs(result.w - result.h * 1.5)).toBeLessThanOrEqual(1);
        }
      }),
    );
  });
});
