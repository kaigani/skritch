// Document <-> JSON for PNG iTXt metadata and .skritch projects. Pure.
import type { Asset, Document } from '../model/types';

export const EMBED_ASSET_LIMIT = 24 * 1024 * 1024;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

type SerialAsset = Omit<Asset, 'bytes'> & { bytes?: string };
export interface SerialDocument extends Omit<Document, 'assets'> {
  assets: Record<string, SerialAsset>;
  /** true when assets were omitted (too large) — the PNG itself becomes the base image on re-open. */
  assetsOmitted?: boolean;
}

/** §4.4: assets are re-embedded as base64 only if their total is < 24 MB. */
export function serializeDocument(doc: Document, embedAssets = true): string {
  const total = Object.values(doc.assets).reduce((n, a) => n + a.bytes.length, 0);
  const embed = embedAssets && total < EMBED_ASSET_LIMIT;
  const assets: Record<string, SerialAsset> = {};
  for (const [id, a] of Object.entries(doc.assets)) {
    assets[id] = {
      id: a.id,
      mime: a.mime,
      width: a.width,
      height: a.height,
      ...(embed ? { bytes: toBase64(a.bytes) } : {}),
    };
  }
  const out: SerialDocument = { ...doc, assets, ...(embed ? {} : { assetsOmitted: true }) };
  return JSON.stringify(out);
}

export function deserializeDocument(json: string): SerialDocument {
  const d = JSON.parse(json) as SerialDocument;
  if (d.version !== 1 || !d.canvas || !Array.isArray(d.objects)) throw new Error('Not a Skritch document');
  return d;
}

/** Converts a serial document whose assets are all present back into a Document. */
export function hydrateDocument(d: SerialDocument): Document | null {
  const assets: Record<string, Asset> = {};
  for (const [id, a] of Object.entries(d.assets)) {
    if (!a.bytes) return null;
    assets[id] = { ...a, bytes: fromBase64(a.bytes) };
  }
  const { assetsOmitted: _omit, ...rest } = d;
  return { ...rest, assets } as Document;
}
