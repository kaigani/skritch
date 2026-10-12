import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  desktop: false,
  videoProbe: vi.fn(),
  videoMakeProxy: vi.fn(),
  on: vi.fn(),
  allowAssetPath: vi.fn(),
  videoThumbnail: vi.fn(),
  fileUrl: (path: string) => `asset:${path}`,
}));
vi.mock('../../src/ipc', () => ({
  get isTauri() {
    return backend.desktop;
  },
  ipc: { platform: 'mac', ...backend },
}));
vi.mock('../../src/actions/image', () => ({
  askArrival: vi.fn(),
  assetFromBytes: vi.fn(),
  confirmDiscard: vi.fn(),
}));

import { importVideos } from '../../src/actions/video';
import { edl, newProject, video } from '../../src/state/video';
import { ui, useUi } from '../../src/state/ui';

beforeEach(() => {
  vi.clearAllMocks();
  backend.desktop = false;
  backend.on.mockResolvedValue(() => {});
  video().close();
  useUi.setState({ mode: 'empty', frameEdit: false, confirm: null, busy: null, toasts: [] });
  backend.allowAssetPath.mockResolvedValue(undefined);
  // Avoid generating a thumbnail URL; unrelated metadata must not affect these assertions.
  backend.videoThumbnail.mockRejectedValue(new Error('no thumbnail'));
  backend.videoProbe.mockImplementation(async (path: string) => ({
    path,
    displayName: path.split('/').pop(),
    fps: 24,
    width: 640,
    height: 360,
    durationSec: 1,
    codec: 'h264',
    hasAudio: true,
    frames: Float64Array.from({ length: 24 }, (_, i) => i / 24),
    rotation: 0,
  }));
});

afterEach(() => vi.unstubAllGlobals());

async function currentEdit() {
  await importVideos(['/original.mp4']);
  video().exec('Rename', () => ({ title: 'Current edit' }));
  edl.trim(0, 'start', 4, 'trim');
  video().seal();
  video().setPlayhead(7);
  video().set({ lastRenderPath: '/previous-export.mp4' });
  return video().project!;
}

describe('video arrivals', () => {
  it('opens the first video without a choice', async () => {
    await importVideos(['/first.mp4']);
    expect(ui().confirm).toBeNull();
    expect(ui().mode).toBe('video');
    expect(video().project?.sequence).toHaveLength(1);
    expect(video().project?.output).toEqual({ fps: 24, width: 640, height: 360 });
    expect(ui().busy).toBeNull();
  });

  it('cancels before probing and keeps edits, playhead, filename and history', async () => {
    const existing = await currentEdit();
    backend.videoProbe.mockClear();
    video().set({ playing: true });
    const pending = importVideos(['/new.mp4']);
    expect(ui().confirm?.buttons.map((b) => b.value)).toEqual(['cancel', 'replace', 'add']);
    expect(video().playing).toBe(false);
    ui().confirm!.resolve('cancel');
    await pending;
    expect(backend.videoProbe).not.toHaveBeenCalled();
    expect(video().project).toBe(existing);
    expect(video().playhead).toBe(7);
    expect(video().canUndo).toBe(true);
  });

  it('appends multiple files in filename order and supports undo/redo without losing the edit', async () => {
    const existing = await currentEdit();
    const pending = importVideos(['/clip10.mp4', '/clip2.mp4']);
    expect(ui().confirm?.title).toBe('Open new videos?');
    ui().confirm!.resolve('add');
    await pending;
    const p = video().project!;
    expect(p.id).toBe(existing.id);
    expect(p.title).toBe('Current edit');
    expect(p.sequence[0]).toEqual(existing.sequence[0]);
    expect(p.sequence.map((s) => p.clips[s.clipId].path)).toEqual([
      '/original.mp4',
      '/clip2.mp4',
      '/clip10.mp4',
    ]);
    expect(video().playhead).toBe(7);
    video().undo();
    expect(video().project).toEqual(existing);
    video().redo();
    expect(video().project?.sequence).toHaveLength(3);
  });

  it('replaces with a fresh timeline only once a new clip is loaded', async () => {
    const existing = await currentEdit();
    let finish!: (info: unknown) => void;
    const info = await backend.videoProbe('/replacement.mp4');
    backend.videoProbe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = importVideos(['/replacement.mp4']);
    ui().confirm!.resolve('replace');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(video().project).toBe(existing);
    finish(info);
    await pending;
    const p = video().project!;
    expect(p.id).not.toBe(existing.id);
    expect(p.title).toBe('Untitled Video');
    expect(Object.values(p.clips).map((c) => c.path)).toEqual(['/replacement.mp4']);
    expect(p.sequence).toHaveLength(1);
    expect(p.markers).toEqual({});
    expect(video().playhead).toBe(0);
    expect(video().lastRenderPath).toBeNull();
    video().undo();
    expect(video().project?.sequence).toHaveLength(0);
    expect(video().project?.id).toBe(p.id);
  });

  it('keeps the current edit if every replacement file fails', async () => {
    const existing = await currentEdit();
    backend.videoProbe.mockRejectedValue(new Error('Cannot decode'));
    const pending = importVideos(['/broken.mp4']);
    ui().confirm!.resolve('replace');
    await pending;
    expect(video().project).toBe(existing);
    expect(video().playhead).toBe(7);
    expect(ui().toasts.at(-1)?.text).toContain('Cannot decode');
    expect(ui().busy).toBeNull();
  });

  it('does not prompt for an empty timeline or an empty arrival', async () => {
    video().open(newProject());
    useUi.setState({ mode: 'video' });
    await importVideos([]);
    expect(backend.videoProbe).not.toHaveBeenCalled();
    await importVideos(['/first.mp4']);
    expect(ui().confirm).toBeNull();
    expect(video().project?.sequence).toHaveLength(1);
  });

  it('does not restore old clips when their background proxies finish after replacement', async () => {
    backend.desktop = true;
    vi.stubGlobal('document', { createElement: () => ({ canPlayType: () => '' }) });
    let finishOld!: (result: { proxyPath: string }) => void;
    backend.videoMakeProxy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    backend.videoMakeProxy.mockResolvedValue({ proxyPath: '/new-proxy.mp4' });
    const existing = await currentEdit();
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    const oldClipId = existing.sequence[0].clipId;
    const pending = importVideos(['/replacement.mp4']);
    ui().confirm!.resolve('replace');
    await pending;
    await vi.waitFor(() =>
      expect(Object.values(video().project!.clips)[0].playUrl).toBe('asset:/new-proxy.mp4'),
    );
    finishOld({ proxyPath: '/old-proxy.mp4' });
    await vi.waitFor(() => expect(video().proxyProgress[oldClipId]).toBeUndefined());
    expect(Object.values(video().project!.clips).map((c) => c.path)).toEqual(['/replacement.mp4']);
  });
});
