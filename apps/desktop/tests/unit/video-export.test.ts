import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderJob } from '../../src/ipc';

const backend = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: any) => void>>(),
  tempWrite: vi.fn(),
  videoRender: vi.fn(),
  videoCancel: vi.fn(),
  videoFramePng: vi.fn(),
  imageConvert: vi.fn(),
}));
vi.mock('../../src/ipc', () => ({
  isTauri: true,
  ipc: {
    platform: 'mac',
    ...backend,
    on: async (name: string, callback: (event: any) => void) => {
      const handlers = backend.handlers.get(name) ?? new Set();
      backend.handlers.set(name, handlers);
      handlers.add(callback);
      return () => handlers.delete(callback);
    },
  },
}));

import { clearVideoDragExport, prepareVideoExport } from '../../src/export/video';
import { newProject, video } from '../../src/state/video';

function emit(name: string, event: unknown) {
  backend.handlers.get(name)?.forEach((handler) => handler(event));
}
async function complete(promise: Promise<string | null>, call = 1) {
  await vi.waitFor(() => expect(backend.videoRender).toHaveBeenCalledTimes(call));
  const job = backend.videoRender.mock.calls[call - 1][0] as RenderJob;
  emit('video://render-done', { jobId: `job-${call}`, path: job.outPath });
  return promise;
}

beforeEach(() => {
  clearVideoDragExport();
  vi.clearAllMocks();
  backend.handlers.clear();
  backend.tempWrite.mockImplementation(async (name: string) => `/tmp/unique/${name}`);
  backend.videoRender.mockImplementation(async () => `job-${backend.videoRender.mock.calls.length}`);
  backend.videoCancel.mockResolvedValue(undefined);
  backend.videoFramePng.mockResolvedValue(new Uint8Array([1, 2, 3]));
  backend.imageConvert.mockResolvedValue(new Uint8Array([4, 5, 6]));
  const p = newProject();
  p.title = 'Final cut';
  p.clips.a = {
    id: 'a',
    path: '/original.mov',
    proxyPath: '/proxy.mp4',
    displayName: 'Source',
    fps: 30,
    width: 640,
    height: 360,
    durationSec: 1,
    codec: 'h264',
    hasAudio: true,
    frames: Float64Array.from({ length: 30 }, (_, i) => i / 30),
    rotation: 90,
  };
  p.sequence = [{ id: 's', clipId: 'a', start: 3, end: 15 }];
  p.output = { width: 640, height: 360, fps: 30 };
  video().open(p);
  video().set({ audio: true, playhead: 2, lastRenderPath: '/old-untrimmed.mp4' });
});

describe('video drag exports', () => {
  it('does not start a render or frame extraction for an empty sequence', async () => {
    video().exec('Remove all clips', () => ({ sequence: [] }));
    expect(await prepareVideoExport('mp4-h264')).toBeNull();
    expect(await prepareVideoExport('png')).toBeNull();
    expect(backend.videoRender).not.toHaveBeenCalled();
    expect(backend.videoFramePng).not.toHaveBeenCalled();
  });

  it('renders the current trimmed originals as MP4, waits for completion, and reuses only the same edit', async () => {
    const first = prepareVideoExport('mp4-h264');
    const second = prepareVideoExport('mp4-h264');
    expect(await complete(first)).toBe('/tmp/unique/Final cut.mp4');
    expect(await second).toBe('/tmp/unique/Final cut.mp4');
    expect(backend.videoRender).toHaveBeenCalledTimes(1);
    expect(backend.videoRender.mock.calls[0][0]).toMatchObject({
      format: 'mp4-h264',
      audio: true,
      inputs: [{ path: '/original.mov', hasAudio: true }],
      segments: [{ input: 0, start: 0.1, end: 0.5 }],
    });
    video().exec('Trim', (p) => ({ sequence: [{ ...p.sequence[0], start: 6 }] }));
    const changed = prepareVideoExport('mp4-h264');
    await complete(changed, 2);
    expect(backend.videoRender.mock.calls[1][0].segments[0].start).toBe(0.2);
  });

  it('uses MOV, the renamed filename and audio setting instead of a previous MP4 export', async () => {
    await complete(prepareVideoExport('mp4-h264'));
    video().exec('Rename', () => ({ title: 'Presentation' }));
    video().set({ audio: false });
    expect(await complete(prepareVideoExport('mov'), 2)).toBe('/tmp/unique/Presentation.mov');
    expect(backend.videoRender.mock.calls[1][0]).toMatchObject({ format: 'mov', audio: false });
  });

  it.each(['wav', 'm4a'] as const)(
    'renders the edit as %s audio even while preview audio is muted',
    async (format) => {
      video().set({ audio: false });
      expect(await complete(prepareVideoExport(format))).toBe(`/tmp/unique/Final cut.${format}`);
      expect(backend.videoRender.mock.calls[0][0]).toMatchObject({
        format,
        audio: true,
        segments: [{ input: 0, start: 0.1, end: 0.5 }],
      });
      expect(backend.videoFramePng).not.toHaveBeenCalled();
    },
  );

  it('refuses an audio export when no clip has audio', async () => {
    video().exec('Mute source', (p) => ({ clips: { a: { ...p.clips.a, hasAudio: false } } }));
    await expect(prepareVideoExport('wav')).rejects.toThrow('no audio');
    expect(backend.videoRender).not.toHaveBeenCalled();
  });

  it.each(['png', 'jpg', 'tiff', 'pdf', 'bmp', 'gif'] as const)(
    'exports only the playhead frame as %s',
    async (format) => {
      const path = await prepareVideoExport(format);
      expect(path).toBe(`/tmp/unique/Final cut.${format}`);
      expect(backend.videoFramePng).toHaveBeenCalledWith('/original.mov', 5 / 30, 90);
      expect(backend.videoRender).not.toHaveBeenCalled();
      if (format === 'png') expect(backend.imageConvert).not.toHaveBeenCalled();
      else expect(backend.imageConvert).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), format, 0.9);
    },
  );

  it('handles completion before invoke returns and ignores unrelated render events', async () => {
    backend.videoRender.mockImplementation(async (job: RenderJob) => {
      emit('video://render-error', { jobId: 'another-job', message: 'unrelated' });
      emit('video://render-done', { jobId: 'job-1', path: job.outPath });
      return 'job-1';
    });
    expect(await prepareVideoExport('mov')).toBe('/tmp/unique/Final cut.mov');
    expect([...backend.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
  });

  it('cancels obsolete renders and removes their listeners', async () => {
    const first = prepareVideoExport('mp4-h264');
    const rejected = expect(first).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(backend.videoRender).toHaveBeenCalledTimes(1));
    const second = prepareVideoExport('mov');
    await rejected;
    await complete(second, 2);
    expect(backend.videoCancel).toHaveBeenCalledWith('job-1');
    expect([...backend.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
  });

  it('reports render errors, cleans up and permits retry', async () => {
    const first = prepareVideoExport('mov');
    const rejected = expect(first).rejects.toThrow('encoder unavailable');
    await vi.waitFor(() => expect(backend.videoRender).toHaveBeenCalledTimes(1));
    emit('video://render-error', { jobId: 'job-1', message: 'encoder unavailable' });
    await rejected;
    await complete(prepareVideoExport('mov'), 2);
    expect([...backend.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
  });
});
