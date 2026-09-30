// Routes incoming files (open dialog, window/tray/Drop Zone drops, argv, captures) to image or video mode.
import { ipc, type CaptureKind, type CaptureResult, type DropSource } from '../ipc';
import {
  IMAGE_EXTS,
  PROJECT_EXTS,
  VIDEO_EXTS,
  baseName,
  extOf,
  defaultFileStem,
  isImagePath,
  isVideoPath,
} from '../export/formats';
import { errorText, ui } from '../state/ui';
import { arriveImages, openProjectBytes, type IncomingImage } from './image';
import { importVideos, openVideoProject } from './video';

export async function openPaths(paths: string[], source: DropSource | 'open' = 'open'): Promise<void> {
  const videos = paths.filter(isVideoPath);
  const images = paths.filter(isImagePath);
  const projects = paths.filter((p) => PROJECT_EXTS.includes(extOf(p)));
  const unknown = paths.length - videos.length - images.length - projects.length;
  if (unknown) ui().toast(`Skipped ${unknown} unsupported file${unknown > 1 ? 's' : ''}`);
  try {
    for (const p of projects) {
      const bytes = await ipc.fileRead(p);
      if (extOf(p) === 'skritchv') await openVideoProject(bytes);
      else await openProjectBytes(bytes, p);
    }
    if (images.length) {
      const imgs: IncomingImage[] = await Promise.all(
        images.map(async (p) => ({
          bytes: await ipc.fileRead(p),
          name: baseName(p),
          path: p,
          source: 'file' as const,
        })),
      );
      await arriveImages(imgs);
    }
    if (videos.length) await importVideos(videos);
  } catch (e) {
    ui().toast(`Couldn’t open: ${errorText(e)}`, { kind: 'error' });
  }
  if (source === 'tray' || source === 'dropzone') void ipc.showMainWindow();
}

export async function openWithDialog(): Promise<void> {
  const paths = await ipc.openDialog({
    multiple: true,
    filters: [
      { name: 'Images, videos and projects', extensions: [...IMAGE_EXTS, ...VIDEO_EXTS, ...PROJECT_EXTS] },
    ],
  });
  if (paths?.length) await openPaths(paths);
}

export async function startCapture(kind: CaptureKind): Promise<void> {
  ui().set({ popover: null });
  try {
    await ipc.captureStart(kind);
  } catch (e) {
    ui().toast(`Capture failed: ${errorText(e)}`, { kind: 'error' });
  }
}

export async function onCaptureResult(r: CaptureResult): Promise<void> {
  const bytes = await ipc.fileRead(r.pngPath);
  await arriveImages([
    {
      bytes,
      name: defaultFileStem(new Date(r.capturedAt ?? Date.now()), r.windowTitle ?? 'Screenshot'),
      source: 'capture',
      capturedAt: r.capturedAt,
    },
  ]);
}
