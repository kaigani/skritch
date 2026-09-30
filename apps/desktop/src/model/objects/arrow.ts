import type { Pt } from '../types';

/**
 * Skitch arrow (§1.2): tapered body, narrow at the tail and wider toward the head, with a large
 * solid triangular head. Returned as a single closed polygon so it can be filled (and haloed) in
 * one pass.
 */
export function arrowPolygon(from: Pt, to: Pt, stroke: number): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return [from, to];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const headLen = Math.min(len * 0.6, Math.max(14, stroke * 4.2));
  const headHalf = Math.max(8, stroke * 2.6) * Math.min(1, (len * 0.6) / headLen);
  const tailHalf = Math.max(0.75, stroke * 0.18);
  const neckHalf = Math.max(1.5, stroke * 0.85);

  const base = { x: to.x - ux * headLen, y: to.y - uy * headLen };
  const P = (p: Pt, k: number): Pt => ({ x: p.x + nx * k, y: p.y + ny * k });

  return [
    P(from, tailHalf),
    P(base, neckHalf),
    P(base, headHalf),
    to,
    P(base, -headHalf),
    P(base, -neckHalf),
    P(from, -tailHalf),
  ];
}
