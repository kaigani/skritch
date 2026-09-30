import { useRef } from 'react';
import { copyAsFile, copyImage, save, saveAs, saveProject } from '../actions/image';
import { backToVideo, exportFramePng, saveVideoProject } from '../actions/video';
import { seqLength } from '../model/edl';
import { formatTimecode } from '../model/timecode';
import { isDirty, useDoc } from '../state/document';
import { useUi } from '../state/ui';
import { useVideo } from '../state/video';
import { IMAGE_FORMATS } from '../export/formats';
import { CropBar } from './CropBar';
import { CaptureButton } from './CaptureButton';
import { Icon } from './icons';
import { MenuItem, Popover } from './Popover';
import { kb } from './keys';

export function TopBar() {
  const popover = useUi((s) => s.popover);
  const set = useUi((s) => s.set);
  const mode = useUi((s) => s.mode);
  const frameEdit = useUi((s) => s.frameEdit);
  const cropping = useUi((s) => s.tool === 'crop' && !!s.crop);
  const shareRef = useRef<HTMLButtonElement>(null);
  const close = () => set({ popover: null });
  const run = (f: () => unknown) => () => {
    close();
    void f();
  };
  const hasDoc = useDoc((s) => !!s.doc);

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="left">
        {frameEdit && (
          <button className="pill" onClick={() => void backToVideo()} title="Back to Video (Esc)">
            <Icon.back /> Back to Video
          </button>
        )}
        <CaptureButton />
      </div>
      <div className="center" data-tauri-drag-region>
        {cropping && mode === 'image' ? <CropBar /> : <Title />}
      </div>
      <div className="right">
        <button
          ref={shareRef}
          className="pill"
          aria-haspopup="menu"
          onClick={() => set({ popover: popover === 'share' ? null : 'share' })}
        >
          <Icon.share /> Share <span className="caret">▼</span>
        </button>
      </div>

      {popover === 'share' && (
        <Popover anchor={shareRef.current} placement="below" align="end" className="menu" onClose={close}>
          {mode === 'video' ? (
            <div role="menu" aria-label="Share">
              <MenuItem
                label="Export Video…"
                kbd={kb('E')}
                onClick={run(() => set({ exportVideoOpen: true }))}
              />
              <MenuItem
                label="Export Frame as PNG…"
                kbd={kb('E', { shift: true })}
                onClick={run(exportFramePng)}
              />
              <hr />
              <MenuItem label="Save Video Project…" onClick={run(saveVideoProject)} />
            </div>
          ) : (
            <div role="menu" aria-label="Share">
              <MenuItem label="Copy Image" kbd={kb('C')} disabled={!hasDoc} onClick={run(copyImage)} />
              <MenuItem label="Copy as File" disabled={!hasDoc} onClick={run(copyAsFile)} />
              <hr />
              <MenuItem label="Save" kbd={kb('S')} disabled={!hasDoc} onClick={run(save)} />
              <MenuItem
                label="Save As…"
                kbd={kb('S', { shift: true })}
                disabled={!hasDoc}
                onClick={run(() => saveAs())}
              />
              <div className="heading">Export as</div>
              {IMAGE_FORMATS.map((f) => (
                <MenuItem
                  key={f.id}
                  label={`${f.label}…`}
                  kbd={f.id === 'png' ? kb('E') : undefined}
                  disabled={!hasDoc}
                  onClick={run(() => saveAs(f.id))}
                />
              ))}
              <hr />
              <MenuItem label="Save Project…" disabled={!hasDoc} onClick={run(saveProject)} />
            </div>
          )}
        </Popover>
      )}
    </header>
  );
}

function Title() {
  const mode = useUi((s) => s.mode);
  const title = useDoc((s) => s.doc?.meta.title);
  const dirty = useDoc(isDirty);
  const size = useDoc((s) => (s.doc ? `${s.doc.canvas.w} × ${s.doc.canvas.h}` : ''));
  const project = useVideo((s) => s.project);
  if (mode === 'video' && project) {
    const n = project.sequence.length;
    const len = seqLength(project.sequence);
    return (
      <div className="title" data-tauri-drag-region data-testid="title">
        Untitled Video{' '}
        <span className="dim">
          — {n} clip{n === 1 ? '' : 's'} · {formatTimecode(len, project.output.fps)} ·{' '}
          {Math.round(project.output.fps * 100) / 100} fps
        </span>
      </div>
    );
  }
  if (mode === 'empty')
    return (
      <div className="title" data-tauri-drag-region>
        Skritch
      </div>
    );
  return (
    <div className="title" data-tauri-drag-region data-testid="title">
      {title}
      {dirty ? ' — Edited' : ''} <span className="dim">· {size}</span>
    </div>
  );
}
