import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { crc32, isPng, pngSize, readITXt, writeITXt, SKRITCH_KEY } from '../../src/export/png-metadata';
import { deserializeDocument, hydrateDocument, serializeDocument } from '../../src/export/serialize';
import { documentFromImage } from '../../src/model/commands/document';

/** Builds a tiny valid RGBA PNG in memory. */
function makePng(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set([255, 47, 146, 255], y * (1 + w * 4) + 1 + x * 4);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('png-metadata', () => {
  it('crc32 matches the PNG spec check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips an iTXt chunk and replaces an existing one', () => {
    const png = makePng(4, 3);
    expect(isPng(png)).toBe(true);
    expect(pngSize(png)).toEqual({ width: 4, height: 3 });
    const a = writeITXt(png, SKRITCH_KEY, '{"hello":"wörld"}');
    expect(readITXt(a, SKRITCH_KEY)).toBe('{"hello":"wörld"}');
    const b = writeITXt(a, SKRITCH_KEY, 'second');
    expect(readITXt(b, SKRITCH_KEY)).toBe('second');
    expect(b.length).toBeLessThan(a.length + 10);
    expect(readITXt(png, SKRITCH_KEY)).toBeNull();
  });

  it('serializes a document with embedded assets and restores it', () => {
    const png = makePng(4, 3);
    const doc = documentFromImage(
      { id: 'as1', mime: 'image/png', width: 4, height: 3, bytes: png },
      { source: 'file' },
    );
    const withMeta = writeITXt(png, SKRITCH_KEY, serializeDocument(doc));
    const restored = hydrateDocument(deserializeDocument(readITXt(withMeta, SKRITCH_KEY)!))!;
    expect(restored.objects).toEqual(doc.objects);
    expect(Array.from(restored.assets.as1.bytes)).toEqual(Array.from(png));
  });

  it('omits assets when asked (too large) and hydrate returns null', () => {
    const png = makePng(2, 2);
    const doc = documentFromImage(
      { id: 'as1', mime: 'image/png', width: 2, height: 2, bytes: png },
      { source: 'file' },
    );
    const s = deserializeDocument(serializeDocument(doc, false));
    expect(s.assetsOmitted).toBe(true);
    expect(hydrateDocument(s)).toBeNull();
  });
});
