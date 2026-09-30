// Off-screen canvases that also work where OffscreenCanvas is missing (older WKWebView on macOS,
// WebKit ports): falls back to a detached <canvas> element with the same drawing API.

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnyContext2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

export function makeCanvas(width: number, height: number): AnyCanvas {
  if (hasOffscreen) return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export const context2d = (c: AnyCanvas): AnyContext2D => c.getContext('2d') as AnyContext2D;

export async function canvasToBlob(c: AnyCanvas, type = 'image/png', quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error(`could not encode ${type}`))), type, quality),
  );
}

export async function canvasToBytes(c: AnyCanvas, type = 'image/png', quality?: number): Promise<Uint8Array> {
  return new Uint8Array(await (await canvasToBlob(c, type, quality)).arrayBuffer());
}
