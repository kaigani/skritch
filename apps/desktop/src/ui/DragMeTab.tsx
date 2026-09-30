import { useEffect, useRef, useState } from 'react';
import { ipc, isTauri } from '../ipc';
import { canvasToBytes, context2d, makeCanvas } from '../util/canvas';
import { encodeDocument, writeTempExport } from '../actions/image';
import { videoDragPath } from '../actions/video';
import { formatInfo, defaultFileStem, safeFileStem } from '../export/formats';
import { docState, useDoc } from '../state/document';
import { errorText, ui, useUi } from '../state/ui';
import appIcon from '../assets/app-icon.png';

/** Small PNG used as the OS drag image. */
async function dragIcon(): Promise<string> {
  const c = makeCanvas(64, 64);
  const g = context2d(c);
  const bitmap = await createImageBitmap(await (await fetch(appIcon)).blob());
  g.drawImage(bitmap, 4, 4, 56, 56);
  bitmap.close();
  return ipc.tempWrite('skritch-drag-icon.png', await canvasToBytes(c));
}

/**
 * The signature "Drag Me" tab (§1.1): dragging it out drops the flattened image (in the chosen format)
 * onto Finder/Explorer, mail, chat, browsers… In the desktop app this starts a native OS file drag; in a
 * plain browser it falls back to an HTML5 DownloadURL drag.
 */
export function DragMeTab({ disabled }: { disabled: boolean }) {
  const format = useUi((s) => s.dragFormat);
  const mode = useUi((s) => s.mode);
  const revision = useDoc((s) => s.revision);
  const [preparing, setPreparing] = useState(false);
  const start = useRef<{
    x: number;
    y: number;
    pointer: number;
    moving: boolean;
    file: Promise<[string | null, string] | null>;
  } | null>(null);
  const browserUrl = useRef<{ url: string; name: string; mime: string } | null>(null);
  const generation = useRef({ value: 0 }).current;

  useEffect(() => {
    return () => {
      generation.value++;
      start.current = null;
      if (browserUrl.current) URL.revokeObjectURL(browserUrl.current.url);
      browserUrl.current = null;
    };
  }, [format, mode, generation]);

  useEffect(() => {
    if (isTauri) return;
    generation.value++;
    if (browserUrl.current) URL.revokeObjectURL(browserUrl.current.url);
    browserUrl.current = null;
  }, [revision, generation]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    // Commit a filename still being edited before taking the export snapshot.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    if (!isTauri) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Handle rejection immediately, even if this turns out to be a click rather than a drag.
    const file = Promise.all([ui().mode === 'video' ? videoDragPath() : writeTempExport(), dragIcon()]).catch(
      (err) => {
        ui().toast(`Drag failed: ${errorText(err)}`, { kind: 'error' });
        return null;
      },
    );
    start.current = { x: e.clientX, y: e.clientY, pointer: e.pointerId, moving: false, file };
  };

  const onPointerMove = async (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.moving || Math.hypot(e.clientX - s.x, e.clientY - s.y) < 4) return;
    const target = e.currentTarget;
    s.moving = true;
    setPreparing(true);
    try {
      const prepared = await s.file;
      // Releasing/cancelling during encoding must never start a late native drag.
      if (start.current !== s) return;
      start.current = null;
      if (target.hasPointerCapture(s.pointer)) target.releasePointerCapture(s.pointer);
      if (prepared?.[0]) await ipc.dragOut(prepared[0], prepared[1]);
    } catch (err) {
      ui().toast(`Drag failed: ${errorText(err)}`, { kind: 'error' });
    } finally {
      setPreparing(false);
    }
  };

  // DownloadURL must be set synchronously in dragstart. Never substitute PNG for the chosen format.
  const onPointerEnter = async () => {
    if (disabled || isTauri || ui().mode !== 'image') return;
    const doc = docState().doc;
    if (!doc) return;
    const version = ++generation.value;
    if (browserUrl.current) URL.revokeObjectURL(browserUrl.current.url);
    browserUrl.current = null;
    try {
      const f = formatInfo(ui().dragFormat);
      const bytes = await encodeDocument(doc, f.id);
      if (version !== generation.value) return;
      browserUrl.current = {
        url: URL.createObjectURL(new Blob([bytes], { type: f.mime })),
        name: `${safeFileStem(doc.meta.title, ipc.platform) || defaultFileStem(new Date(doc.meta.createdAt))}.${f.ext}`,
        mime: f.mime,
      };
    } catch (err) {
      if (version === generation.value) ui().toast(errorText(err), { kind: 'error' });
    }
  };

  return (
    <button
      type="button"
      className="dragme"
      aria-label="Drag me to share"
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={preparing}
      title={
        disabled
          ? 'Open an image or video to export'
          : `Drag ${mode === 'video' ? 'video' : formatInfo(format).label} to Finder, the Desktop, or another app`
      }
      draggable={!isTauri && !disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onLostPointerCapture={() => (start.current = null)}
      onClick={() => ui().toast('Drag this tab to Finder, the Desktop, or another app to save a file.')}
      onPointerEnter={onPointerEnter}
      onDragStart={(e) => {
        const b = browserUrl.current;
        if (!b) return e.preventDefault();
        // Chromium's preview-only DownloadURL protocol reserves colons as delimiters.
        e.dataTransfer.setData('DownloadURL', `${b.mime}:${b.name.replace(/:/g, '_')}:${b.url}`);
        e.dataTransfer.setData('text/uri-list', b.url);
      }}
    >
      <span className="grip">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      {preparing ? 'Preparing…' : 'Drag Me'}
    </button>
  );
}
