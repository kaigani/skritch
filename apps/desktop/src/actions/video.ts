// Video-mode orchestration: import (§6.8), frame → PNG / frame → image mode (§6.7), project save.
import { nanoid } from 'nanoid';
import { ipc, isTauri, type ClipInfo } from '../ipc';
import { documentFromImage } from '../model/commands/document';
import { locate, type Clip, type VideoProject } from '../model/edl';
import { baseName, extOf } from '../export/formats';
import { fromBase64, toBase64 } from '../export/serialize';
import { docState } from '../state/document';
import { askConfirm, errorText, ui, useUi } from '../state/ui';
import { edl, newProject, useVideo, video } from '../state/video';
import { askArrival, assetFromBytes, confirmDiscard } from './image';

const CODEC_MIME: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  vp8: 'video/webm; codecs="vp8"',
  vp9: 'video/webm; codecs="vp9"',
  av1: 'video/mp4; codecs="av01.0.05M.08"',
};
const PLAYABLE_CONTAINERS = ['mp4', 'mov', 'm4v', 'webm'];

/** §6.8 step 3: can the WebView play the original, or do we need a proxy? */
export function isPlayable(info: Pick<ClipInfo, 'codec' | 'path'>): boolean {
  if (!isTauri) return true; // the browser mock only accepts files the browser already decoded
  const mime = CODEC_MIME[info.codec];
  if (!mime || !PLAYABLE_CONTAINERS.includes(extOf(info.path))) return false;
  return document.createElement('video').canPlayType(mime) !== '';
}

/** First-frame thumbnails for clip blocks; call once the clips are in the project. */
function loadThumbnails(clips: Clip[]): void {
  for (const c of clips)
    void ipc
      .videoThumbnail(c.path, c.frames[0], 80)
      .then((png) => {
        const cur = video().project?.clips[c.id];
        if (cur)
          video().setClip({ ...cur, thumbnail: URL.createObjectURL(new Blob([png], { type: 'image/png' })) });
      })
      .catch(() => {});
}

async function loadClip(path: string): Promise<Clip> {
  await ipc.allowAssetPath(path);
  const info = await ipc.videoProbe(path);
  if (!info.frames.length) throw { message: `${baseName(path)} has no video frames` };
  const clip: Clip = {
    id: nanoid(8),
    path,
    displayName: info.displayName || baseName(path),
    fps: info.fps || 30,
    width: info.width,
    height: info.height,
    durationSec: info.durationSec,
    codec: info.codec,
    hasAudio: info.hasAudio,
    frames: info.frames,
    rotation: info.rotation,
  };
  if (isPlayable(info)) clip.playUrl = ipc.fileUrl(path);
  else void makeProxy(clip);
  return clip;
}

/** Transcodes a playable proxy in the background; the clip block shows progress (§6.8). */
async function makeProxy(clip: Clip): Promise<void> {
  const off = await ipc.on<{ id: string; progress: number }>('video://proxy', (e) => {
    if (e.id === clip.id)
      useVideo.setState((s) => ({ proxyProgress: { ...s.proxyProgress, [clip.id]: e.progress } }));
  });
  try {
    useVideo.setState((s) => ({ proxyProgress: { ...s.proxyProgress, [clip.id]: 0 } }));
    const { proxyPath } = await ipc.videoMakeProxy(clip.path, clip.id);
    await ipc.allowAssetPath(proxyPath);
    const proxy = await ipc.videoProbe(proxyPath);
    const cur = video().project?.clips[clip.id] ?? clip;
    video().setClip({ ...cur, proxyPath, proxyFrames: proxy.frames, playUrl: ipc.fileUrl(proxyPath) });
  } catch (e) {
    ui().toast(`Couldn’t prepare ${clip.displayName}: ${errorText(e)}`, { kind: 'error' });
  } finally {
    off();
    useVideo.setState((s) => {
      const { [clip.id]: _done, ...rest } = s.proxyProgress;
      return { proxyProgress: rest };
    });
  }
}

/**
 * Entry point for video arrivals (§6.1): opens Video mode, or appends to the open project (3A).
 * Multiple files are appended in filename-sorted order.
 */
export async function importVideos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const sorted = [...paths].sort((a, b) =>
    baseName(a).localeCompare(baseName(b), undefined, { numeric: true }),
  );
  if (ui().frameEdit && !(await backToVideo())) return;
  if (ui().mode === 'image' && docState().doc) {
    const choice = await askArrival('video', paths.length);
    if (choice === 'cancel') return;
    docState().close();
  }
  if (ui().mode !== 'video' || !video().project) {
    video().open(newProject());
    useUi.setState({ mode: 'video', crop: null, popover: null });
  }
  useUi.setState({ busy: paths.length > 1 ? `Importing ${paths.length} clips…` : 'Importing clip…' });
  try {
    const clips: Clip[] = [];
    for (const p of sorted) {
      try {
        clips.push(await loadClip(p));
      } catch (e) {
        ui().toast(`Couldn’t import ${baseName(p)}: ${errorText(e)}`, { kind: 'error' });
      }
    }
    if (clips.length) {
      edl.appendClips(clips);
      loadThumbnails(clips);
    }
    if (!video().project?.sequence.length) closeVideo();
  } finally {
    useUi.setState({ busy: null });
  }
}

export function closeVideo(): void {
  video().close();
  useUi.setState({ mode: docState().doc ? 'image' : 'empty' });
}

/** Presentation time of the frame under the playhead in the ORIGINAL clip. */
function currentFrameRef() {
  const { project, playhead } = video();
  if (!project) return null;
  const loc = locate(project.sequence, playhead);
  if (!loc) return null;
  const clip = project.clips[loc.seg.clipId];
  return { clip, clipFrame: loc.clipFrame, pts: clip.frames[loc.clipFrame] };
}

async function currentFramePng(): Promise<{ png: Uint8Array; name: string } | null> {
  const ref = currentFrameRef();
  if (!ref) return null;
  const png = await ipc.videoFramePng(ref.clip.path, ref.pts, ref.clip.rotation);
  return { png, name: `${baseName(ref.clip.displayName)}-f${ref.clipFrame}.png` };
}

/** ⇧⌘E — full-resolution frame from the original, via a Save dialog (§6.7). */
export async function exportFramePng(): Promise<void> {
  try {
    const f = await currentFramePng();
    if (!f) return;
    const path = await ipc.saveDialog({
      defaultPath: f.name,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!path) return;
    await ipc.fileWrite(path, f.png);
    ui().toast(`Saved ${f.name}`);
  } catch (e) {
    ui().toast(`Couldn’t export frame: ${errorText(e)}`, { kind: 'error' });
  }
}

/** Temp file for the Drag Me tab in video mode: the rendered video if one exists, else the frame. */
export async function videoDragPath(): Promise<string | null> {
  const rendered = video().lastRenderPath;
  if (rendered) return rendered;
  const f = await currentFramePng();
  return f ? ipc.tempWrite(f.name, f.png) : null;
}

/** ⌘⏎ — open the current frame as an image document, pushing the video onto the mode stack. */
export async function editFrameAsImage(): Promise<void> {
  try {
    const f = await currentFramePng();
    if (!f) return;
    useVideo.setState({ playing: false });
    const asset = await assetFromBytes(f.png);
    const doc = documentFromImage(asset, { source: 'video-frame', title: f.name.replace(/\.png$/, '') });
    await docState().open(doc);
    useUi.setState({ mode: 'image', frameEdit: true, crop: null });
  } catch (e) {
    ui().toast(`Couldn’t open frame: ${errorText(e)}`, { kind: 'error' });
  }
}

/** ← Back to Video: restores the project at the same playhead (the project never left memory). */
export async function backToVideo(): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  docState().close();
  useUi.setState({ mode: 'video', frameEdit: false, crop: null, editingTextId: null });
  return true;
}

// ---- .skritchv project (JSON referencing source paths + frame indices) -------------------------

interface SerialProject extends Omit<VideoProject, 'clips'> {
  clips: Record<string, Omit<Clip, 'frames' | 'proxyFrames' | 'playUrl' | 'thumbnail'> & { frames: string }>;
}

export async function saveVideoProject(): Promise<void> {
  const p = video().project;
  if (!p) return;
  const path = await ipc.saveDialog({
    defaultPath: 'Untitled Video.skritchv',
    filters: [{ name: 'Skritch Video Project', extensions: ['skritchv'] }],
  });
  if (!path) return;
  const clips: SerialProject['clips'] = {};
  for (const c of Object.values(p.clips)) {
    const { frames, proxyFrames: _pf, playUrl: _pu, thumbnail: _t, proxyPath: _pp, ...rest } = c;
    clips[c.id] = {
      ...rest,
      frames: toBase64(new Uint8Array(frames.buffer, frames.byteOffset, frames.byteLength)),
    };
  }
  const out: SerialProject = { ...p, clips, playhead: video().playhead };
  await ipc.fileWrite(path, new TextEncoder().encode(JSON.stringify(out)));
  useVideo.setState({ savedProject: p });
  ui().toast('Video project saved');
}

export async function openVideoProject(bytes: Uint8Array): Promise<void> {
  const s = JSON.parse(new TextDecoder().decode(bytes)) as SerialProject;
  const clips: Record<string, Clip> = {};
  for (const c of Object.values(s.clips)) {
    const u8 = fromBase64(c.frames);
    const clip: Clip = { ...c, frames: new Float64Array(u8.buffer, u8.byteOffset, u8.byteLength / 8) };
    await ipc.allowAssetPath(c.path);
    if (isPlayable({ codec: c.codec, path: c.path })) clip.playUrl = ipc.fileUrl(c.path);
    else void makeProxy(clip);
    clips[c.id] = clip;
  }
  if (ui().mode === 'image' && !(await confirmDiscard())) return;
  docState().close();
  video().open({ ...s, clips });
  useUi.setState({ mode: 'video', frameEdit: false });
  loadThumbnails(Object.values(clips));
}

/** Close request in video mode: "Save video?" opens the Export dialog (Save = render, §6.5). */
export async function confirmCloseVideo(): Promise<boolean> {
  const { project, savedProject } = video();
  if (!project || project === savedProject || !project.sequence.length) return true;
  const v = await askConfirm({
    title: 'Save video?',
    message: 'Your edits are not rendered yet. Saving renders a new video file.',
    buttons: [
      { label: 'Don’t Save', value: 'discard' },
      { label: 'Cancel', value: 'cancel', cancel: true },
      { label: 'Save…', value: 'save', primary: true },
    ],
  });
  if (v === 'save') useUi.setState({ exportVideoOpen: true });
  return v === 'discard';
}
