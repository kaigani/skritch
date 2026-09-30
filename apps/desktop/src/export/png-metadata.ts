// PNG iTXt chunk read/write (§4.4). Pure: operates on byte arrays only.

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
export const SKRITCH_KEY = 'skritch:document';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIG.every((b, i) => bytes[i] === b);
}

interface Chunk {
  type: string;
  start: number; // offset of the length field
  dataStart: number;
  length: number;
}

function* chunks(bytes: Uint8Array): Generator<Chunk> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 12 <= bytes.length) {
    const length = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    yield { type, start: off, dataStart: off + 8, length };
    off += 12 + length;
    if (type === 'IEND') return;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** iTXt: keyword\0 compressionFlag(0) compressionMethod(0) languageTag\0 translatedKeyword\0 text(UTF-8) */
function buildITXt(key: string, text: string): Uint8Array {
  const k = enc.encode(key);
  const t = enc.encode(text);
  const data = new Uint8Array(k.length + 5 + t.length);
  data.set(k, 0);
  let o = k.length;
  data[o++] = 0; // keyword terminator
  data[o++] = 0; // compression flag
  data[o++] = 0; // compression method
  data[o++] = 0; // empty language tag
  data[o++] = 0; // empty translated keyword
  data.set(t, o);
  return buildChunk('iTXt', data);
}

/** Inserts (or replaces) an iTXt chunk with `key` just before IEND. */
export function writeITXt(png: Uint8Array, key: string, text: string): Uint8Array {
  if (!isPng(png)) throw new Error('not a PNG');
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let iend: Chunk | null = null;
  for (const c of chunks(png)) {
    if (c.type === 'IEND') {
      iend = c;
      break;
    }
    if (c.type === 'iTXt' && readKey(png, c) === key) continue;
    parts.push(png.subarray(c.start, c.start + 12 + c.length));
  }
  if (!iend) throw new Error('PNG has no IEND');
  parts.push(buildITXt(key, text));
  parts.push(png.subarray(iend.start, iend.start + 12));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function readKey(png: Uint8Array, c: Chunk): string {
  let e = c.dataStart;
  while (e < c.dataStart + c.length && png[e] !== 0) e++;
  return dec.decode(png.subarray(c.dataStart, e));
}

/** Returns the uncompressed iTXt text for `key`, or null. */
export function readITXt(png: Uint8Array, key: string): string | null {
  if (!isPng(png)) return null;
  for (const c of chunks(png)) {
    if (c.type !== 'iTXt') continue;
    if (readKey(png, c) !== key) continue;
    let o = c.dataStart + enc.encode(key).length + 1;
    const compressed = png[o];
    o += 2;
    while (png[o] !== 0) o++; // language tag
    o++;
    while (png[o] !== 0) o++; // translated keyword
    o++;
    if (compressed) return null; // we never write compressed chunks
    return dec.decode(png.subarray(o, c.dataStart + c.length));
  }
  return null;
}

/** Reads width/height from the IHDR chunk. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (!isPng(png)) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
