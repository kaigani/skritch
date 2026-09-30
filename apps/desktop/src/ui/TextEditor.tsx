import { useLayoutEffect, useRef } from 'react';
import { renderer } from '../canvas/Renderer';
import { TEXT_FONT_FAMILY, textHaloWidth } from '../canvas/paint';
import { extendCanvasToFit, removeObjects, replaceObjects } from '../model/commands/document';
import { measureText } from '../model/objects';
import type { TextObject } from '../model/types';
import { docState, useDoc } from '../state/document';
import { useUi } from '../state/ui';

/**
 * In-place text editing with a real <textarea> (contenteditable is unreliable across WebViews, §4.3),
 * styled to match the rendered text. Commits on blur / Esc / ⌘⏎. Canvas extension happens on commit.
 */
export function TextEditor() {
  const id = useUi((s) => s.editingTextId);
  useUi((s) => s.viewRev);
  useUi((s) => s.zoom);
  const obj = useDoc((s) =>
    id ? (s.doc?.objects.find((o) => o.id === id) as TextObject | undefined) : undefined,
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);

  // Focus synchronously so the first keystrokes after the click land in the editor. The canvas
  // pointerdown is preventDefault-ed, so the browser's mousedown focus change can't steal it back.
  useLayoutEffect(() => {
    committed.current = false;
    ref.current?.focus();
    ref.current?.select();
  }, [id]);

  if (!id || !obj || !renderer) return null;
  const r = renderer;
  const key = `text:${id}`;
  const p = r.toScreen(obj.pos);
  const fs = obj.fontSize * r.zoom;
  const m = measureText(obj.text || ' ', obj.fontSize);
  const halo = textHaloWidth(obj.fontSize) * r.zoom;

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const cur = docState().doc?.objects.find((o) => o.id === id) as TextObject | undefined;
    if (cur && !cur.text.trim()) docState().execute({ ...removeObjects([id]), coalesceKey: key });
    else docState().execute(extendCanvasToFit([id], key));
    docState().seal();
    useUi.setState({ editingTextId: null });
  };

  return (
    <textarea
      key={id}
      ref={ref}
      className="text-editor"
      aria-label="Text"
      spellCheck={false}
      defaultValue={obj.text}
      style={{
        left: p.x - 1,
        top: p.y - 1,
        width: m.w * r.zoom + fs * 1.2,
        height: m.h * r.zoom + 4,
        fontSize: fs,
        fontFamily: TEXT_FONT_FAMILY,
        color: obj.color,
        paddingLeft: halo / 2,
        paddingTop: fs * 0.08,
        textShadow: `0 0 ${Math.max(1, halo / 2)}px #fff, 0 0 ${Math.max(1, halo / 2)}px #fff, 0 0 1px #fff`,
        caretColor: obj.color,
      }}
      onChange={(e) => docState().execute(replaceObjects([{ ...obj, text: e.target.value }], 'Text', key))}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
