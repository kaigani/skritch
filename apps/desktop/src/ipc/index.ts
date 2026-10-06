// Typed IPC wrappers (§7). The ONLY module that calls invoke(). When running outside Tauri (Vite dev
// server in a browser, Playwright), a mock backend with the same surface is used instead.
import type { Rect } from '../model/types';
import { mockBackend } from './mock';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type CaptureKind = 'crosshair' | 'timed' | 'fullscreen' | 'window' | 'previous';
export interface CaptureResult {
  pngPath: string;
  width: number;
  height: number;
  scale: number;
  windowTitle?: string | null;
  capturedAt?: number;
}
export interface OverlayInfo {
  /** Identifies the capture; overlay pages are reused between captures. */
  session: number;
  width: number;
  height: number;
  scale: number;
  windows: Array<Rect & { title?: string }>;
  mode: 'crosshair' | 'timed' | 'window';
}
export interface ClipInfo {
  path: string;
  displayName: string;
  container: string;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  codec: string;
  hasAudio: boolean;
  rotation: 0 | 90 | 180 | 270;
  frames: Float64Array;
}
export type VideoFormat = 'mp4-h264' | 'mp4-hevc' | 'mov' | 'webm';
export interface RenderJob {
  outPath: string;
  format: VideoFormat;
  quality: 'low' | 'medium' | 'high';
  width: number;
  height: number;
  fps: number;
  audio: boolean;
  inputs: { path: string; hasAudio: boolean }[];
  segments: { input: number; start: number; end: number }[];
}
export interface RenderProgress {
  jobId: string;
  progress: number;
  frame: number;
  fps: number;
  etaSec: number | null;
}
export type ImageFormat = 'png' | 'jpg' | 'tiff' | 'pdf' | 'bmp' | 'gif';
export type MenuAction = string;
export type DropSource = 'window' | 'tray' | 'dropzone' | 'args';

export interface Backend {
  menuSetEnabled(enabled: Record<string, boolean>): Promise<void>;
  clipboardReadText(): Promise<string | null>;
  clipboardWriteText(text: string): Promise<void>;
  printDocument(): Promise<void>;
  pageSetup(): Promise<void>;
  captureStart(kind: CaptureKind): Promise<void>;
  /** Last capture if < 10 min old ("Recover Last Capture"). */
  captureLast(): Promise<CaptureResult | null>;
  /** macOS: System Settings › Privacy & Security › Screen Recording. */
  openScreenRecordingSettings(): Promise<void>;
  overlayInfo(display: number): Promise<OverlayInfo>;
  /** The frozen display, ready to draw (raw pixels from the backend, no image decode). */
  overlayShot(display: number): Promise<CanvasImageSource & { width: number; height: number }>;
  /** The overlay has drawn the shot and may be shown. */
  overlayReady(display: number, session: number): Promise<void>;
  overlayFinish(display: number, rect: Rect | null, timed: boolean): Promise<void>;
  permissionStatus(): Promise<'granted' | 'denied' | 'unknown'>;
  clipboardReadImage(): Promise<Uint8Array | null>;
  clipboardWriteImage(png: Uint8Array): Promise<void>;
  clipboardWriteFiles(paths: string[]): Promise<void>;
  fileRead(path: string): Promise<Uint8Array>;
  fileWrite(path: string, bytes: Uint8Array): Promise<void>;
  tempWrite(name: string, bytes: Uint8Array): Promise<string>;
  imageConvert(png: Uint8Array, format: Exclude<ImageFormat, 'png'>, quality: number): Promise<Uint8Array>;
  defaultSaveDir(): Promise<string>;
  allowAssetPath(path: string): Promise<void>;
  /** URL the webview can load for a local file path. */
  fileUrl(path: string): string;
  openDialog(opts: {
    multiple: boolean;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string[] | null>;
  saveDialog(opts: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  videoProbe(path: string): Promise<ClipInfo>;
  videoMakeProxy(path: string, id: string): Promise<{ proxyPath: string }>;
  videoThumbnail(path: string, ptsTime: number, height: number): Promise<Uint8Array>;
  videoFramePng(path: string, ptsTime: number, rotation: number): Promise<Uint8Array>;
  videoEncoders(): Promise<{ h264?: string; hevc?: string; vp9?: string }>;
  videoRender(job: RenderJob): Promise<string>;
  videoCancel(jobId: string): Promise<void>;
  setDropZoneVisible(visible: boolean): Promise<void>;
  showMainWindow(): Promise<void>;
  takeLaunchPaths(): Promise<string[]>;
  dragOut(path: string, iconPath: string): Promise<void>;
  prefsGet<T>(key: string): Promise<T | undefined>;
  prefsSet(key: string, value: unknown): Promise<void>;
  on<T>(event: string, cb: (payload: T) => void): Promise<() => void>;
  onWindowDrop(
    cb: (paths: string[], files?: File[]) => void,
    onHover?: (over: boolean) => void,
  ): Promise<() => void>;
  setTitle(title: string): Promise<void>;
  closeWindow(): Promise<void>;
  platform: 'mac' | 'windows' | 'other';
}

const b64ToF64 = (b64: string): Float64Array => {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float64Array(u8.buffer);
};

async function tauriBackend(): Promise<Backend> {
  const core = await import('@tauri-apps/api/core');
  const win = await import('@tauri-apps/api/window');
  const wv = await import('@tauri-apps/api/webview');
  const dialog = await import('@tauri-apps/plugin-dialog');
  const { LazyStore } = await import('@tauri-apps/plugin-store');
  const { invoke } = core;
  const store = new LazyStore('prefs.json');
  const bytes = async (cmd: string, args?: Record<string, unknown>) =>
    new Uint8Array(await invoke<ArrayBuffer>(cmd, args));
  const raw = (cmd: string, body: Uint8Array, headers: Record<string, string>) =>
    invoke(cmd, body, {
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, encodeURIComponent(v)])),
    });
  const ua = navigator.userAgent;

  return {
    menuSetEnabled: (enabled) => invoke('menu_set_enabled', { enabled }),
    clipboardReadText: () => invoke('clipboard_read_text'),
    clipboardWriteText: (text) => invoke('clipboard_write_text', { text }),
    printDocument: () => invoke('print_document'),
    pageSetup: () => invoke('page_setup'),
    platform: /Mac/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'other',
    captureStart: (kind) => invoke('capture_start', { kind }),
    captureLast: () => invoke('capture_last'),
    openScreenRecordingSettings: () => invoke('open_screen_recording_settings'),
    overlayInfo: (display) => invoke('capture_overlay_info', { display }),
    overlayShot: async (display) => {
      // [width u32 LE][height u32 LE][RGBA8 rows]
      const buf = await invoke<ArrayBuffer>('capture_overlay_pixels', { display });
      const [width, height] = new Uint32Array(buf, 0, 2);
      return createImageBitmap(new ImageData(new Uint8ClampedArray(buf, 8, width * height * 4), width, height));
    },
    overlayReady: (display, session) => invoke('capture_overlay_ready', { display, session }),
    overlayFinish: (display, rect, timed) => invoke('capture_overlay_finish', { display, rect, timed }),
    permissionStatus: () => invoke('capture_permission_status'),
    clipboardReadImage: async () => {
      const b = await bytes('clipboard_read_image');
      return b.length ? b : null;
    },
    clipboardWriteImage: (png) => raw('clipboard_write_image', png, {}) as Promise<void>,
    clipboardWriteFiles: (paths) => invoke('clipboard_write_files', { paths }),
    fileRead: (path) => bytes('file_read', { path }),
    fileWrite: (path, b) => raw('file_write', b, { 'x-path': path }) as Promise<void>,
    tempWrite: (name, b) => raw('temp_write', b, { 'x-name': name }) as Promise<string>,
    imageConvert: async (png, format, quality) =>
      new Uint8Array(
        (await raw('image_convert', png, {
          'x-format': format,
          'x-quality': String(quality),
        })) as ArrayBuffer,
      ),
    defaultSaveDir: () => invoke('default_save_dir'),
    allowAssetPath: (path) => invoke('allow_asset_path', { path }),
    fileUrl: (path) => core.convertFileSrc(path),
    openDialog: async ({ multiple, filters }) => {
      const r = await dialog.open({ multiple, filters, directory: false });
      if (r === null) return null;
      return Array.isArray(r) ? r : [r];
    },
    saveDialog: (opts) => dialog.save(opts),
    videoProbe: async (path) => {
      const r = await invoke<Omit<ClipInfo, 'frames'> & { framesB64: string }>('video_probe', { path });
      const { framesB64, ...rest } = r;
      return { ...rest, frames: b64ToF64(framesB64) };
    },
    videoMakeProxy: (path, id) => invoke('video_make_proxy', { path, id }),
    videoThumbnail: (path, ptsTime, height) => bytes('video_thumbnail', { path, ptsTime, height }),
    videoFramePng: (path, ptsTime, rotation) => bytes('video_frame_png', { path, ptsTime, rotation }),
    videoEncoders: () => invoke('video_encoders'),
    videoRender: (job) => invoke('video_render', { job }),
    videoCancel: (jobId) => invoke('video_cancel', { jobId }),
    setDropZoneVisible: (visible) => invoke('tray_set_dropzone_visible', { visible }),
    showMainWindow: () => invoke('show_main_window'),
    takeLaunchPaths: () => invoke('take_launch_paths'),
    // Native drag that hides this window while it runs (src-tauri/src/windows/dragout.rs).
    dragOut: (path, iconPath) => invoke('drag_out', { path, icon: iconPath }),
    prefsGet: (key) => store.get(key),
    prefsSet: async (key, value) => {
      await store.set(key, value);
      await store.save();
    },
    on: (event, cb) => win.getCurrentWindow().listen(event, (e) => cb(e.payload as any)),
    onWindowDrop: (cb, onHover) =>
      wv.getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'enter' || p.type === 'over') onHover?.(true);
        else if (p.type === 'leave') onHover?.(false);
        else if (p.type === 'drop') {
          onHover?.(false);
          cb(p.paths);
        }
      }),
    setTitle: (title) => win.getCurrentWindow().setTitle(title),
    closeWindow: () => win.getCurrentWindow().close(),
  };
}

let backendPromise: Promise<Backend> | null = null;
export function backend(): Promise<Backend> {
  if (!backendPromise) backendPromise = isTauri ? tauriBackend() : Promise.resolve(mockBackend());
  return backendPromise;
}

/** Synchronous handle, valid after `initBackend()` resolved at startup. */
export let ipc: Backend;
export async function initBackend(): Promise<Backend> {
  ipc = await backend();
  return ipc;
}
