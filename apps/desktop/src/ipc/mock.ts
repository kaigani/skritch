import { BRAND_PINK } from '../theme';

// Browser stand-in for the Rust backend so the UI runs under `vite dev` and Playwright (§9 "mocked IPC").
// Paths are virtual (`mem://…`) and map to in-memory blobs.
import { canvasToBytes, context2d, makeCanvas } from '../util/canvas';
import type { Backend, CaptureResult, ClipInfo } from './index';

const files = new Map<string, Blob>();
const urls = new Map<string, string>();
const bus = new EventTarget();
let counter = 0;

const emit = (event: string, payload: unknown) =>
  bus.dispatchEvent(new CustomEvent(event, { detail: payload }));

function putFile(name: string, blob: Blob): string {
  const path = `mem://${++counter}/${name}`;
  files.set(path, blob);
  return path;
}

function getBlob(path: string): Blob {
  const b = files.get(path);
  if (!b) throw { code: 'not_found', message: `No such file: ${path}` };
  return b;
}

const canvasToPng = canvasToBytes;

/** A synthetic "desktop" so captures have something recognisable in them. */
function fakeScreenshot(w: number, h: number, n: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, n % 2 ? '#1d6fa5' : '#3b3f8f');
  grad.addColorStop(1, n % 2 ? '#7ec8e3' : '#c471ed');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // a "window"
  const wx = w * 0.12,
    wy = h * 0.14,
    ww = w * 0.62,
    wh = h * 0.64;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(wx + 6, wy + 10, ww, wh);
  g.fillStyle = '#f7f7f7';
  g.fillRect(wx, wy, ww, wh);
  g.fillStyle = '#e3e3e3';
  g.fillRect(wx, wy, ww, 28);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(wx + 16 + i * 18, wy + 14, 6, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = '#333';
  g.font = '600 20px Inter, system-ui, sans-serif';
  g.fillText(`Capture #${n} — Quarterly report`, wx + 24, wy + 70);
  g.font = '15px Inter, system-ui, sans-serif';
  for (let i = 0; i < 8; i++) {
    g.fillStyle = '#666';
    g.fillText(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.',
      wx + 24,
      wy + 110 + i * 26,
    );
  }
  g.fillStyle = '#007aff';
  g.fillRect(wx + 24, wy + wh - 70, 120, 36);
  g.fillStyle = '#fff';
  g.font = '600 15px Inter, system-ui, sans-serif';
  g.fillText('Submit', wx + 58, wy + wh - 46);
  // chart
  const cx = wx + ww * 0.62,
    cy = wy + 90;
  [60, 110, 80, 150, 120].forEach((v, i) => {
    g.fillStyle = ['#ff9500', '#4cd964', '#5856d6', BRAND_PINK, '#007aff'][i];
    g.fillRect(cx + i * 34, cy + 170 - v, 24, v);
  });
  return c;
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject({ code: 'decode', message: 'Cannot decode video in this browser' });
  });
}

async function grabFrame(path: string, t: number, height?: number): Promise<Uint8Array> {
  const v = await loadVideo(mock.fileUrl(path));
  await new Promise<void>((r) => {
    v.onseeked = () => r();
    v.currentTime = t;
  });
  const scale = height ? height / v.videoHeight : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  return canvasToPng(c);
}

let clipboardText: string | null = null;
const mock: Backend = {
  menuSetEnabled: async () => {},
  clipboardReadText: async () => clipboardText,
  clipboardWriteText: async (text) => {
    clipboardText = text;
  },
  printDocument: async () => window.print(),
  pageSetup: async () => window.print(),
  platform: /Mac/.test(navigator.userAgent)
    ? 'mac'
    : /Windows/.test(navigator.userAgent)
      ? 'windows'
      : 'other',
  async captureStart(kind) {
    const n = ++counter;
    const [w, h] =
      kind === 'fullscreen'
        ? [1440, 900]
        : kind === 'window'
          ? [900, 600]
          : [720 + (n % 3) * 80, 460 + (n % 2) * 60];
    // Keep synthetic captures deterministic: Chromium can defer toBlob while the canvas rAF runs.
    const data = fakeScreenshot(w, h, n).toDataURL('image/png').split(',')[1];
    const png = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const pngPath = putFile(`capture-${n}.png`, new Blob([png], { type: 'image/png' }));
    const delay = kind === 'timed' ? 800 : 120;
    setTimeout(
      () =>
        emit('capture://result', {
          pngPath,
          width: w,
          height: h,
          scale: 1,
          windowTitle: 'Quarterly report',
          capturedAt: Date.now(),
        } satisfies CaptureResult),
      delay,
    );
  },
  captureLast: async () => null,
  openScreenRecordingSettings: async () => {},
  async overlayInfo() {
    const png = await canvasToPng(fakeScreenshot(window.innerWidth, window.innerHeight, 1));
    return {
      shotPath: putFile('shot.png', new Blob([png], { type: 'image/png' })),
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      windows: [{ x: 120, y: 90, w: 600, h: 400, title: 'Mock window' }],
      mode: (new URLSearchParams(location.search).get('mode') as any) ?? 'crosshair',
    };
  },
  async overlayFinish(_d, rect, timed) {
    console.info('[mock] overlay finish', rect, timed);
  },
  permissionStatus: async () => 'granted',
  async clipboardReadImage() {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) return new Uint8Array(await (await it.getType(t)).arrayBuffer());
      }
    } catch {
      /* permission denied or empty */
    }
    return null;
  },
  async clipboardWriteImage(png) {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) }),
    ]);
  },
  async clipboardWriteFiles() {
    throw { code: 'unsupported', message: 'Copy as file is only available in the desktop app' };
  },
  fileRead: async (path) => new Uint8Array(await getBlob(path).arrayBuffer()),
  async fileWrite(path, bytes) {
    files.set(path, new Blob([bytes]));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = path.split(/[\\/]/).pop()!;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  },
  tempWrite: async (name, bytes) => putFile(name, new Blob([bytes])),
  async imageConvert(png, format, quality) {
    if (format !== 'jpg')
      throw { code: 'unsupported', message: `${format.toUpperCase()} export needs the desktop app` };
    const bmp = await createImageBitmap(new Blob([png]));
    const c = makeCanvas(bmp.width, bmp.height);
    const g = context2d(c);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0);
    return canvasToPng(c, 'image/jpeg', quality);
  },
  defaultSaveDir: async () => 'Pictures/Skritch',
  allowAssetPath: async () => {},
  fileUrl(path) {
    let u = urls.get(path);
    if (!u) {
      u = URL.createObjectURL(getBlob(path));
      urls.set(path, u);
    }
    return u;
  },
  openDialog: ({ multiple, filters }) =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = multiple;
      if (filters) input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
      input.onchange = () => resolve(Array.from(input.files ?? []).map((f) => putFile(f.name, f)));
      input.oncancel = () => resolve(null);
      input.click();
    }),
  saveDialog: async ({ defaultPath }) => defaultPath ?? 'Untitled.png',
  async videoProbe(path): Promise<ClipInfo> {
    const v = await loadVideo(mock.fileUrl(path));
    const fps = 30;
    const count = Math.max(1, Math.floor(v.duration * fps + 1e-6));
    const frames = new Float64Array(count);
    for (let i = 0; i < count; i++) frames[i] = i / fps;
    return {
      path,
      displayName: path.split('/').pop()!,
      container: path.split('.').pop() ?? 'mp4',
      fps,
      width: v.videoWidth,
      height: v.videoHeight,
      durationSec: v.duration,
      codec: 'unknown',
      hasAudio: false,
      rotation: 0,
      frames,
    };
  },
  videoMakeProxy: async () => {
    throw { code: 'unsupported', message: 'Proxy generation needs the desktop app' };
  },
  videoThumbnail: (path, t, height) => grabFrame(path, t, height),
  videoFramePng: (path, t) => grabFrame(path, t),
  videoEncoders: async () => ({ h264: 'mock', vp9: 'mock' }),
  async videoRender(job) {
    const jobId = `job${++counter}`;
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(1, p + 0.1);
      emit('video://render', {
        jobId,
        progress: p,
        frame: Math.round(p * 100),
        fps: 120,
        etaSec: (1 - p) * 2,
      });
      if (p >= 1) {
        clearInterval(tick);
        emit('video://render-done', { jobId, path: job.outPath });
      }
    }, 150);
    return jobId;
  },
  videoCancel: async () => {},
  setDropZoneVisible: async () => {},
  showMainWindow: async () => {},
  takeLaunchPaths: async () => [],
  dragOut: async () => {},
  prefsGet: async (key) => {
    const v = localStorage.getItem(`skritch:${key}`);
    return v === null ? undefined : JSON.parse(v);
  },
  prefsSet: async (key, value) => localStorage.setItem(`skritch:${key}`, JSON.stringify(value)),
  on: async (event, cb) => {
    const h = (e: Event) => cb((e as CustomEvent).detail);
    bus.addEventListener(event, h);
    return () => bus.removeEventListener(event, h);
  },
  onWindowDrop: async (cb, onHover) => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      onHover?.(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) onHover?.(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      onHover?.(false);
      const list = Array.from(e.dataTransfer.files);
      cb(
        list.map((f) => putFile(f.name, f)),
        list,
      );
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  },
  setTitle: async (title) => {
    document.title = title;
  },
  closeWindow: async () => {},
};

export function mockBackend(): Backend {
  // Test hooks (Playwright): inject files and fire backend events.
  (window as any).__skritchMock = {
    emit,
    readClipboardText: () => clipboardText,
    putFile: (name: string, bytes: Uint8Array | ArrayBuffer, type = '') =>
      putFile(name, new Blob([bytes], { type })),
    /** A virtual file backed by an http URL (engines that can't play blob: media, e.g. WebKit on Windows). */
    putRemote: async (name: string, url: string) => {
      const path = putFile(name, await (await fetch(url)).blob());
      urls.set(path, url);
      return path;
    },
    fakeScreenshotPng: async (w: number, h: number, n = 1) => canvasToPng(fakeScreenshot(w, h, n)),
  };
  return mock;
}
