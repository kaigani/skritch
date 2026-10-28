import { ipc, isTauri, type RenderJob } from '../ipc';
import { locate } from '../model/edl';
import { buildRenderJob } from '../model/renderJob';
import { ui } from '../state/ui';
import { video } from '../state/video';
import {
  isAudioFormat,
  isRenderedFormat,
  videoDragFormatInfo,
  videoFileStem,
  type VideoDragFormat,
} from './formats';

// Native temp files are purged after 24 hours; renew cached exports before then.
const MAX_CACHE_AGE_MS = 23 * 60 * 60 * 1000;
let cached: { key: string; promise: Promise<string>; controller: AbortController; createdAt: number } | null =
  null;

/** Drop obsolete preparation when leaving video mode or choosing a still format. */
export function clearVideoDragExport(): void {
  cached?.controller.abort();
  cached = null;
}

/** Snapshot the current edit or frame; never substitute an older Save/Export result. */
export async function prepareVideoExport(
  format: VideoDragFormat = ui().videoDragFormat,
): Promise<string | null> {
  const { project, playhead, audio } = video();
  if (!project?.sequence.length) return null;
  const info = videoDragFormatInfo(format);
  const name = `${videoFileStem(project.title, ipc.platform)}.${info.ext}`;
  if (!isRenderedFormat(format)) {
    const loc = locate(project.sequence, playhead);
    if (!loc) return null;
    const clip = project.clips[loc.seg.clipId];
    const png = await ipc.videoFramePng(clip.path, clip.frames[loc.clipFrame], clip.rotation);
    const bytes = format === 'png' ? png : await ipc.imageConvert(png, format, 0.9);
    return ipc.tempWrite(name, bytes);
  }
  if (!isTauri)
    throw new Error(
      'Video rendering needs the desktop app. Choose an image format to export a still frame here.',
    );
  const audioOnly = isAudioFormat(format);
  if (audioOnly && !Object.values(project.clips).some((c) => c.hasAudio))
    throw new Error('This video has no audio. Choose a video or image format instead.');
  const job = buildRenderJob(project, {
    outPath: '',
    format,
    quality: 'high',
    width: project.output.width,
    height: project.output.height,
    fps: project.output.fps,
    // Preview mute applies to video exports; an audio export always carries the sound.
    audio: audioOnly || audio,
  });
  // Metadata such as thumbnails and proxy progress must not trigger a fresh render.
  const key = JSON.stringify([project.id, name, job]);
  if (cached?.key === key && Date.now() - cached.createdAt < MAX_CACHE_AGE_MS) return cached.promise;
  clearVideoDragExport();
  const controller = new AbortController();
  const promise = (async () => {
    // tempWrite reserves a unique folder; FFmpeg writes directly to this destination.
    const outPath = await ipc.tempWrite(name, new Uint8Array());
    controller.signal.throwIfAborted();
    return renderToPath({ ...job, outPath }, controller.signal);
  })();
  const entry = { key, promise, controller, createdAt: Date.now() };
  cached = entry;
  void promise.catch(() => {
    if (cached === entry) cached = null;
  });
  return promise;
}

async function renderToPath(job: RenderJob, signal: AbortSignal): Promise<string> {
  let jobId: string | null = null;
  const early = new Map<string, { path?: string; message?: string }>();
  let resolve!: (path: string) => void;
  let reject!: (error: Error) => void;
  const completion = new Promise<string>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  // Cancellation may occur while listener registration or invoke is pending.
  void completion.catch(() => {});
  const receive = (id: string, result: { path?: string; message?: string }) => {
    if (jobId === null) {
      early.set(id, result);
      return;
    }
    if (id !== jobId) return;
    if (result.message !== undefined) reject(new Error(result.message));
    else if (result.path) resolve(result.path);
  };
  const abort = () => {
    reject(new Error('Video preparation cancelled'));
    if (jobId) void ipc.videoCancel(jobId).catch(() => {});
  };
  const offs: Array<() => void> = [];
  signal.addEventListener('abort', abort, { once: true });
  try {
    offs.push(
      await ipc.on<{ jobId: string; path: string }>('video://render-done', (e) => receive(e.jobId, e)),
    );
    offs.push(
      await ipc.on<{ jobId: string; message: string }>('video://render-error', (e) => receive(e.jobId, e)),
    );
    signal.throwIfAborted();
    jobId = await ipc.videoRender(job);
    if (signal.aborted) abort();
    else if (early.has(jobId)) receive(jobId, early.get(jobId)!);
    return await completion;
  } finally {
    signal.removeEventListener('abort', abort);
    offs.forEach((off) => off());
  }
}
