import { useRef, useState } from 'react';
import { updateObjects } from '../model/commands/document';
import { hasColor, hasSize } from '../model/objects';
import { PALETTE, STROKE_STEPS, type SkObject, type StampGlyph } from '../model/types';
import { docState, useDoc } from '../state/document';
import { useUi, type ShapeTool, type ToolId } from '../state/ui';
import { Icon, StampGlyphIcon } from './icons';
import { Popover } from './Popover';

const TOOLS: { id: ToolId; label: string; key: string; icon: () => JSX.Element; sub?: boolean }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: Icon.select },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: Icon.arrow },
  { id: 'text', label: 'Text', key: 'T', icon: Icon.text },
  { id: 'shape', label: 'Shape', key: 'S', icon: Icon.rect, sub: true },
  { id: 'pen', label: 'Pen', key: 'P', icon: Icon.pen },
  { id: 'highlight', label: 'Highlighter', key: 'H', icon: Icon.highlight },
  { id: 'stamp', label: 'Stamp', key: 'K', icon: Icon.stamp, sub: true },
  { id: 'pixelate', label: 'Pixelate', key: 'B', icon: Icon.pixelate },
  { id: 'crop', label: 'Crop / Resize', key: 'C', icon: Icon.crop },
];

const SHAPES: { id: ShapeTool; label: string; icon: () => JSX.Element }[] = [
  { id: 'rect', label: 'Rectangle', icon: Icon.rect },
  { id: 'roundRect', label: 'Rounded rectangle', icon: Icon.roundRect },
  { id: 'ellipse', label: 'Ellipse', icon: Icon.ellipse },
  { id: 'line', label: 'Line', icon: Icon.line },
];
const STAMPS: StampGlyph[] = ['check', 'x', 'question', 'exclaim', 'heart'];

/** Applies the swatch/size to the selection too (Skitch re-colours the selected object). */
function restyleSelection(p: { color?: string; size?: number }) {
  const { selection } = docState();
  if (!selection.length) return;
  docState().execute(
    updateObjects(
      selection,
      (o: SkObject) => {
        let n = o;
        if (p.color && hasColor(n)) n = { ...n, color: p.color } as SkObject;
        if (p.size && hasSize(n)) n = { ...n, size: p.size } as SkObject;
        return n;
      },
      p.color ? 'Colour' : 'Size',
    ),
  );
}

export function ToolRail() {
  const tool = useUi((s) => s.tool);
  const shape = useUi((s) => s.shape);
  const stamp = useUi((s) => s.stamp);
  const color = useUi((s) => s.color);
  const size = useUi((s) => s.size);
  const popover = useUi((s) => s.popover);
  const hasDoc = useDoc((s) => !!s.doc);
  const set = useUi((s) => s.set);
  const setTool = useUi((s) => s.setTool);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [subAnchor, setSubAnchor] = useState<HTMLElement | null>(null);

  const click = (id: ToolId, sub?: boolean) => {
    if (sub && tool === id) {
      setSubAnchor(refs.current[id]);
      set({
        popover: popover === (id === 'shape' ? 'shape' : 'stamp') ? null : id === 'shape' ? 'shape' : 'stamp',
      });
      return;
    }
    setTool(id);
  };

  const shapeIcon = SHAPES.find((s) => s.id === shape)!.icon;

  return (
    <nav className="rail" aria-label="Tools">
      {TOOLS.map((t) => {
        const I = t.id === 'shape' ? shapeIcon : t.icon;
        return (
          <button
            key={t.id}
            ref={(el) => (refs.current[t.id] = el)}
            className={`tool ${tool === t.id ? 'active' : ''}`}
            title={`${t.label} (${t.key})${t.sub ? ' — click again for options' : ''}`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            disabled={!hasDoc}
            data-tool={t.id}
            onClick={() => click(t.id, t.sub)}
            onContextMenu={(e) => {
              if (!t.sub) return;
              e.preventDefault();
              setTool(t.id);
              setSubAnchor(refs.current[t.id]);
              set({ popover: t.id === 'shape' ? 'shape' : 'stamp' });
            }}
          >
            {t.id === 'stamp' ? <StampGlyphIcon glyph={stamp} /> : <I />}
            {t.sub && <span className="sub" />}
          </button>
        );
      })}
      <div className="divider" />
      <button
        ref={(el) => (refs.current.color = el)}
        className="tool"
        title="Colour and size"
        aria-label="Colour and size"
        data-testid="swatch"
        onClick={() => set({ popover: popover === 'color' ? null : 'color' })}
      >
        <span className="swatch" style={{ background: color }} />
      </button>
      <button
        className="tool sizebtn"
        title="Line size"
        aria-label="Line size"
        onClick={() => set({ popover: popover === 'color' ? null : 'color' })}
      >
        <i className="dot" style={{ width: 4 + size * 3, height: 4 + size * 3 }} />
      </button>

      {popover === 'color' && (
        <Popover anchor={refs.current.color} placement="side" onClose={() => set({ popover: null })}>
          <div className="colorgrid" role="listbox" aria-label="Colours">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={c === color ? 'on' : ''}
                style={{ background: c }}
                aria-label={c}
                title={c}
                onClick={() => {
                  set({ color: c });
                  restyleSelection({ color: c });
                }}
              />
            ))}
            <label className="custom" title="Custom colour">
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  set({ color: e.target.value });
                  restyleSelection({ color: e.target.value });
                }}
              />
            </label>
          </div>
          <div className="sizes" role="listbox" aria-label="Sizes">
            {STROKE_STEPS.map((px, i) => (
              <button
                key={px}
                className={size === i + 1 ? 'on' : ''}
                aria-label={`Size ${i + 1}`}
                onClick={() => {
                  set({ size: i + 1 });
                  restyleSelection({ size: i + 1 });
                }}
              >
                <i style={{ width: px + 2, height: px + 2, background: color }} />
              </button>
            ))}
          </div>
        </Popover>
      )}
      {popover === 'shape' && (
        <Popover anchor={subAnchor} placement="side" onClose={() => set({ popover: null })}>
          <div className="subpicker">
            {SHAPES.map((s) => (
              <button
                key={s.id}
                className={shape === s.id ? 'on' : ''}
                title={s.label}
                aria-label={s.label}
                onClick={() => set({ shape: s.id, popover: null })}
              >
                <s.icon />
              </button>
            ))}
          </div>
        </Popover>
      )}
      {popover === 'stamp' && (
        <Popover anchor={subAnchor} placement="side" onClose={() => set({ popover: null })}>
          <div className="subpicker">
            {STAMPS.map((g) => (
              <button
                key={g}
                className={stamp === g ? 'on' : ''}
                aria-label={g}
                title={g}
                onClick={() => set({ stamp: g, popover: null })}
              >
                <StampGlyphIcon glyph={g} />
              </button>
            ))}
          </div>
        </Popover>
      )}
    </nav>
  );
}
