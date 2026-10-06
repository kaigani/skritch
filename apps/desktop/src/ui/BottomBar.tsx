import { useRef, useState } from 'react';
import { ipc } from '../ipc';
import { renameDocument } from '../model/commands/document';
import { renderer } from '../canvas/Renderer';
import { IMAGE_FORMATS, formatInfo, safeFileStem } from '../export/formats';
import { docState, isDirty, useDoc } from '../state/document';
import { ui, useUi } from '../state/ui';
import { useVideo } from '../state/video';
import { seqLength } from '../model/edl';
import { formatTimecode } from '../model/timecode';
import { DragMeTab } from './DragMeTab';
import { Icon } from './icons';
import { MenuItem, Popover } from './Popover';

// log-scale zoom slider 10 %–800 %
const toSlider = (z: number) => Math.round((Math.log(z / 0.1) / Math.log(80)) * 100);
const fromSlider = (v: number) => 0.1 * Math.pow(80, v / 100);

export function BottomBar() {
  const mode = useUi((s) => s.mode);
  const zoom = useUi((s) => s.zoom);
  const dragFormat = useUi((s) => s.dragFormat);
  const popover = useUi((s) => s.popover);
  const set = useUi((s) => s.set);
  const doc = useDoc((s) => s.doc);
  const dirty = useDoc(isDirty);
  const fmtRef = useRef<HTMLButtonElement>(null);

  return (
    <footer className="bottombar">
      <div className="export-tab">
        {mode !== 'video' && (
          <button
            ref={fmtRef}
            className="format-button"
            aria-label="Drag format"
            aria-haspopup="menu"
            aria-expanded={popover === 'format'}
            title="Choose the file format for Drag Me"
            onClick={() => set({ popover: popover === 'format' ? null : 'format' })}
          >
            {formatInfo(dragFormat).label} <span className="caret">▼</span>
          </button>
        )}
        <DragMeTab disabled={mode === 'empty' || (mode === 'image' && !doc)} />
      </div>
      {mode === 'image' && doc ? (
        <div className="doc-name" data-testid="doc-name">
          <Filename key={doc.id} id={doc.id} title={doc.meta.title} />
          {dirty && <span className="edited">Edited</span>}
        </div>
      ) : mode === 'video' ? (
        <VideoSummary />
      ) : (
        <span className="export-hint">Snap · Mark up · Share</span>
      )}
      {mode === 'image' && doc && (
        <div className="zoom">
          <span className="doc-size" data-testid="doc-size">
            {doc.canvas.w} × {doc.canvas.h}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Zoom"
            value={toSlider(zoom)}
            onChange={(e) => renderer?.setZoom(fromSlider(+e.target.value))}
            onDoubleClick={() => renderer?.fit()}
          />
          <span className="pct" data-testid="zoom-pct">
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="iconbtn"
            title="Fit to window"
            aria-label="Fit to window"
            onClick={() => renderer?.fit()}
          >
            <Icon.fit />
          </button>
        </div>
      )}
      {popover === 'format' && (
        <Popover
          anchor={fmtRef.current}
          placement="above"
          className="menu"
          onClose={() => set({ popover: null })}
        >
          <div role="menu" aria-label="Drag format">
            {IMAGE_FORMATS.map((f) => (
              <MenuItem
                key={f.id}
                label={`${dragFormat === f.id ? '✓ ' : '   '}${f.label}`}
                onClick={() => set({ dragFormat: f.id, popover: null })}
              />
            ))}
          </div>
        </Popover>
      )}
    </footer>
  );
}

function VideoSummary() {
  const project = useVideo((s) => s.project);
  if (!project) return <span className="export-hint">Drag to save a file</span>;
  const n = project.sequence.length;
  return (
    <span className="video-summary" data-testid="video-summary">
      Untitled Video — {n} clip{n === 1 ? '' : 's'} ·{' '}
      {formatTimecode(seqLength(project.sequence), project.output.fps)} ·{' '}
      {Math.round(project.output.fps * 100) / 100} fps
    </span>
  );
}

/** The extension belongs to the format selector; this control edits the shared document filename. */
function Filename({ id, title }: { id: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit && docState().doc?.id === id) {
      const stem = safeFileStem(draft.replace(/\.(png|jpe?g|tiff?|pdf|bmp|gif)$/i, ''), ipc.platform);
      if (!stem) ui().toast('Please enter a filename.');
      else if (stem !== title) {
        docState().execute(renameDocument(stem));
        docState().seal();
      }
    }
    setEditing(false);
  };
  return editing ? (
    <input
      className="filename editing"
      aria-label="Filename"
      value={draft}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(e.key === 'Enter');
        }
      }}
    />
  ) : (
    <button
      className="filename"
      aria-label="Edit filename"
      title={`${title} — click to rename`}
      onClick={() => {
        finished.current = false;
        setDraft(title);
        setEditing(true);
      }}
    >
      {title}
    </button>
  );
}
