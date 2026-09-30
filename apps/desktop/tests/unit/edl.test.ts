import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  copyRange,
  deleteRange,
  expand,
  frameAtTime,
  locate,
  moveSegment,
  pasteAt,
  sanitizeMarkers,
  seekTime,
  segmentTimes,
  seqLength,
  splitAt,
  syntheticFrames,
  trimSegment,
  trimToRange,
  type Segment,
} from '../../src/model/edl';
import { formatDuration, formatTimecode } from '../../src/model/timecode';

const seg = (id: string, clipId: string, start: number, end: number): Segment => ({ id, clipId, start, end });
const base = (): Segment[] => [seg('a', 'A', 0, 10), seg('b', 'B', 5, 15), seg('c', 'A', 20, 25)];

describe('EDL', () => {
  it('locates frames', () => {
    const s = base();
    expect(seqLength(s)).toBe(25);
    expect(locate(s, 0)).toMatchObject({ segIdx: 0, clipFrame: 0 });
    expect(locate(s, 10)).toMatchObject({ segIdx: 1, clipFrame: 5 });
    expect(locate(s, 24)).toMatchObject({ segIdx: 2, clipFrame: 24 });
    expect(locate(s, 25)).toBeNull();
  });

  it('splits, no-op at boundaries', () => {
    expect(splitAt(base(), 10)).toHaveLength(3);
    const s = splitAt(base(), 13);
    expect(s).toHaveLength(4);
    expect(s[1]).toMatchObject({ start: 5, end: 8 });
    expect(s[2]).toMatchObject({ start: 8, end: 15 });
    expect(expand(s)).toEqual(expand(base()));
  });

  it('deletes a range (3C)', () => {
    const s = deleteRange(base(), 8, 12);
    expect(seqLength(s)).toBe(21);
    const full = expand(base());
    expect(expand(s)).toEqual([...full.slice(0, 8), ...full.slice(12)]);
  });

  it('trims to a range (3D)', () => {
    const s = trimToRange(base(), 8, 12);
    expect(expand(s)).toEqual(expand(base()).slice(8, 12));
  });

  it('cut/copy/paste (3E)', () => {
    const clip = copyRange(base(), 2, 6);
    expect(seqLength(clip)).toBe(4);
    const { seq, range } = pasteAt(base(), 20, clip);
    expect(range).toEqual([20, 24]);
    const full = expand(base());
    expect(expand(seq)).toEqual([...full.slice(0, 20), ...full.slice(2, 6), ...full.slice(20)]);
    const ids = new Set(seq.map((x) => x.id));
    expect(ids.size).toBe(seq.length);
  });

  it('moves segments (3A)', () => {
    const ids = (s: Segment[]) => s.map((x) => x.id).join('');
    expect(ids(moveSegment(base(), 0, 3))).toBe('bca');
    expect(ids(moveSegment(base(), 2, 0))).toBe('cab');
    expect(ids(moveSegment(base(), 1, 1))).toBe('abc');
    expect(ids(moveSegment(base(), 1, 2))).toBe('abc');
  });

  it('trims segment edges within the clip', () => {
    const s = trimSegment(base(), 0, 'end', 100, 12);
    expect(s[0].end).toBe(12);
    expect(trimSegment(base(), 0, 'start', 50, 12)[0].start).toBe(9);
  });

  it('sanitizes markers', () => {
    expect(sanitizeMarkers({ in: 5, out: 50 }, 20)).toEqual({ in: 5, out: 20 });
    expect(sanitizeMarkers({ in: 30, out: 50 }, 20)).toEqual({ out: 20 });
    expect(sanitizeMarkers({ in: 10, out: 5 }, 20)).toEqual({ in: 10 });
  });

  it('frame index helpers', () => {
    const f = syntheticFrames(30, 90);
    expect(frameAtTime(f, 1.0)).toBe(30);
    expect(frameAtTime(f, 1.0 + 0.5 / 30)).toBe(30);
    expect(frameAtTime(f, seekTime(f, 45, 30))).toBe(45);
    expect(segmentTimes({ frames: f, durationSec: 3 }, seg('x', 'A', 30, 90))).toEqual({ start: 1, end: 3 });
  });

  // Property: for random op sequences, invariants hold and locate agrees with naive expansion.
  it('property: random op sequences keep invariants', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('del'), a: fc.nat(60), b: fc.nat(60) }),
      fc.record({ k: fc.constant('trim'), a: fc.nat(60), b: fc.nat(60) }),
      fc.record({ k: fc.constant('split'), a: fc.nat(60), b: fc.constant(0) }),
      fc.record({ k: fc.constant('paste'), a: fc.nat(60), b: fc.nat(60) }),
      fc.record({ k: fc.constant('move'), a: fc.nat(8), b: fc.nat(8) }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 12 }), (ops) => {
        let s = base();
        for (const o of ops) {
          const before = expand(s);
          if (o.k === 'del') {
            s = deleteRange(s, o.a, o.b);
            const [lo, hi] = [Math.min(o.a, o.b, before.length), Math.min(Math.max(o.a, o.b), before.length)];
            expect(expand(s)).toEqual([...before.slice(0, lo), ...before.slice(hi)]);
          } else if (o.k === 'trim') {
            const n = s;
            s = trimToRange(s, o.a, o.b);
            if (s !== n) {
              const lo = Math.min(o.a, o.b);
              const hi = Math.min(Math.max(o.a, o.b), before.length);
              expect(expand(s)).toEqual(before.slice(lo, hi));
            }
          } else if (o.k === 'split') {
            s = splitAt(s, o.a);
            expect(expand(s)).toEqual(before);
          } else if (o.k === 'paste') {
            const clip = copyRange(s, o.a, o.b);
            s = pasteAt(s, o.a, clip).seq;
            expect(seqLength(s)).toBe(before.length + seqLength(clip));
          } else {
            s = moveSegment(s, o.a, o.b);
            expect(seqLength(s)).toBe(before.length);
          }
          for (const x of s) expect(x.end).toBeGreaterThan(x.start);
          const flat = expand(s);
          for (let f = 0; f < flat.length; f += 3) {
            const l = locate(s, f)!;
            expect([l.seg.clipId, l.clipFrame]).toEqual(flat[f]);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('timecode', () => {
  it('formats HH:MM:SS:FF', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
    expect(formatTimecode(367, 30)).toBe('00:00:12:07');
    expect(formatTimecode(30 * 3661 + 5, 30)).toBe('01:01:01:05');
  });
  it('formats short durations', () => {
    expect(formatDuration(132, 30)).toBe('4s12');
    expect(formatDuration(30 * 64, 30)).toBe('1m04s');
  });
});
