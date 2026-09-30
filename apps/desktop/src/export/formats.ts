import type { ImageFormat } from '../ipc';

export const IMAGE_FORMATS: { id: ImageFormat; label: string; ext: string; mime: string }[] = [
  { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png' },
  { id: 'jpg', label: 'JPG', ext: 'jpg', mime: 'image/jpeg' },
  { id: 'tiff', label: 'TIFF', ext: 'tiff', mime: 'image/tiff' },
  { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { id: 'bmp', label: 'BMP', ext: 'bmp', mime: 'image/bmp' },
  { id: 'gif', label: 'GIF', ext: 'gif', mime: 'image/gif' },
];

export const formatInfo = (id: ImageFormat) => IMAGE_FORMATS.find((f) => f.id === id)!;

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'];
export const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
export const PROJECT_EXTS = ['skritch', 'skritchv'];

export const extOf = (path: string) => (path.split(/[\\/]/).pop()!.split('.').pop() ?? '').toLowerCase();
export const baseName = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '');
export const isVideoPath = (p: string) => VIDEO_EXTS.includes(extOf(p));
export const isImagePath = (p: string) => IMAGE_EXTS.includes(extOf(p));

export function sniffMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return null;
}

/** Local capture time followed by the source window title. The timestamp is fixed at capture time. */
export function defaultFileStem(d = new Date(), title = 'Screenshot'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}${p(d.getMonth() + 1)}${p(d.getFullYear() % 100)}:${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${title.trim() || 'Screenshot'}`;
}

/** Keep a filename inside its destination folder. Colons are supported by macOS POSIX file APIs. */
export function safeFileStem(name: string, platform: string = 'other'): string {
  let result = name.replace(/[\/\\\x00-\x1f\x7f]/g, '_').trim();
  if (platform === 'windows') result = result.replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/, '');
  // Leave room for the selected extension within common 255-byte filesystem limits.
  const encoder = new TextEncoder();
  let bytes = 0;
  result = Array.from(result)
    .filter((character) => {
      bytes += encoder.encode(character).length;
      return bytes <= 240;
    })
    .join('');
  return /^\.*$/.test(result) ? '' : result;
}
