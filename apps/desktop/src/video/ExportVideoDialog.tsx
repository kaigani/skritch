import { useEffect, useRef, useState } from 'react';
import { ipc, type RenderProgress, type VideoFormat } from '../ipc';
import { buildRenderJob, scaledDims } from '../model/renderJob';
import { seqLength } from '../model/edl';
import { formatTimecode } from '../model/timecode';
import { errorText, ui, useUi } from '../state/ui';
import { usePrefs } from '../state/prefs';
import { useVideo, video } from '../state/video';

const FORMATS: { id: VideoFormat; label: string; ext: string }[] = [
  { id: 'mp4-h264', label: 'MP4 (H.264)', ext: 'mp4' },
  { id: 'mp4-hevc', label: 'MP4 (HEVC)', ext: 'mp4' },
  { id: 'mov', label: 'MOV (H.264)', ext: 'mov' },
  { id: 'webm', label: 'WebM (VP9)', ext: 'webm' },
];

/** Export dialog (§6.6). For video, Save = render. */
export function ExportVideoDialog() {
  const open = useUi((s) => s.exportVideoOpen);
  const project = useVideo((s) => s.project);
  const [format, setFormat] = useState<VideoFormat>('mp4-h264');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('high');
  const [res, setRes] = useState<'source' | '1080' | '720'>('source');
  const [audio, setAudio] = useState(usePrefs.getState().videoAudio);
  const [job, setJob] = useState<{ id: string | null; progress: RenderProgress | null } | null>(null);
  const offs = useRef<Array<() => void>>([]);

  const [encoders, setEncoders] = useState<{ h264?: string; hevc?: string; vp9?: string } | null>(null);

  useEffect(() => () => offs.current.forEach((f) => f()), []);
  useEffect(() => {
    if (open) void ipc.videoEncoders().then(setEncoders, () => setEncoders(null));
  }, [open]);
  const available = (f: VideoFormat) =>
    !encoders || (f === 'mp4-hevc' ? !!encoders.hevc : f === 'webm' ? !!encoders.vp9 : !!encoders.h264);

  if (!open || !project) return null;
  const hasAudio = Object.values(project.clips).some((c) => c.hasAudio);
  const dims = scaledDims(project.output.width, project.output.height, res === 'source' ? null : +res);
  const close = () => {
    offs.current.forEach((f) => f());
    offs.current = [];
    setJob(null);
    useUi.setState({ exportVideoOpen: false });
  };

  const start = async () => {
    const f = FORMATS.find((x) => x.id === format)!;
    const outPath = await ipc.saveDialog({
      defaultPath: `Untitled Video.${f.ext}`,
      filters: [{ name: f.label, extensions: [f.ext] }],
    });
    if (!outPath) return;
    const renderJob = buildRenderJob(project, {
      outPath,
      format,
      quality,
      ...dims,
      fps: project.output.fps,
      audio: audio && hasAudio,
    });
    setJob({ id: null, progress: null });
    let jobId: string | null = null;
    offs.current.push(
      await ipc.on<RenderProgress>(
        'video://render',
        (p) => p.jobId === jobId && setJob({ id: jobId, progress: p }),
      ),
      await ipc.on<{ jobId: string; path: string }>('video://render-done', (p) => {
        if (p.jobId !== jobId) return;
        useVideo.setState({ lastRenderPath: p.path, savedProject: video().project });
        ui().toast(`Exported ${p.path.split(/[\\/]/).pop()}`);
        close();
      }),
      await ipc.on<{ jobId: string; message: string }>('video://render-error', (p) => {
        if (p.jobId !== jobId) return;
        ui().toast(`Export failed: ${p.message}`, { kind: 'error' });
        setJob(null);
      }),
    );
    try {
      jobId = await ipc.videoRender(renderJob);
      setJob({ id: jobId, progress: null });
    } catch (e) {
      ui().toast(`Export failed: ${errorText(e)}`, { kind: 'error' });
      setJob(null);
    }
  };

  const cancel = async () => {
    if (job?.id) await ipc.videoCancel(job.id);
    close();
  };

  const p = job?.progress;
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="sheet wide">
        <h2 id="export-title">Export Video</h2>
        <p>
          {project.sequence.length} segment{project.sequence.length === 1 ? '' : 's'} ·{' '}
          {formatTimecode(seqLength(project.sequence), project.output.fps)} · rendered from the original
          files.
        </p>
        {!job ? (
          <>
            <div className="form">
              <label htmlFor="ex-format">Format</label>
              <select
                id="ex-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as VideoFormat)}
              >
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id} disabled={!available(f.id)}>
                    {f.label}
                    {available(f.id) ? '' : ' — encoder not available'}
                  </option>
                ))}
              </select>
              <label htmlFor="ex-quality">Quality</label>
              <select id="ex-quality" value={quality} onChange={(e) => setQuality(e.target.value as never)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <label htmlFor="ex-res">Resolution</label>
              <select id="ex-res" value={res} onChange={(e) => setRes(e.target.value as never)}>
                <option value="source">
                  Source ({project.output.width}×{project.output.height})
                </option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
              </select>
              <label>Frame rate</label>
              <span>Source ({Math.round(project.output.fps * 100) / 100} fps)</span>
              <label>Audio</label>
              <label style={{ textAlign: 'left' }}>
                <input
                  type="checkbox"
                  checked={audio && hasAudio}
                  disabled={!hasAudio}
                  onChange={(e) => setAudio(e.target.checked)}
                />{' '}
                Include audio
              </label>
            </div>
            <div className="buttons">
              <button className="pill" onClick={close}>
                Cancel
              </button>
              <button className="pill primary" onClick={() => void start()}>
                Export…
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="progress" aria-label="Export progress">
              <i style={{ width: `${Math.round((p?.progress ?? 0) * 100)}%` }} />
            </div>
            <p style={{ marginTop: 8, color: '#666' }}>
              {p
                ? `${Math.round(p.progress * 100)}% · ${Math.round(p.fps)} fps ${p.etaSec !== null ? ` · ${Math.ceil(p.etaSec)} s left` : ''}`
                : 'Starting…'}
            </p>
            <div className="buttons">
              <button className="pill" onClick={() => void cancel()}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
