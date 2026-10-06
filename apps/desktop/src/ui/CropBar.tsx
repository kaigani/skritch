import { intersect } from '../model/geometry';
import type { ImageObject } from '../model/types';
import { applyCrop, cancelCrop } from '../canvas/tools/CropTool';
import { useDoc } from '../state/document';
import { useUi, type CropMode, type CropState } from '../state/ui';
import { Icon } from './icons';

const MIN_SCALE = 1;
const MAX_SCALE = 1000;
const clampScale = (pct: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, pct || MIN_SCALE));

/** Crop / Scale segmented control shown in the top bar while the Crop tool is active (§5.3). */
export function CropBar() {
  const crop = useUi((s) => s.crop)!;
  const canvas = useDoc((s) => s.doc!.canvas);
  const image = useDoc((s) =>
    s.doc?.objects.find((o): o is ImageObject => o.id === crop.targetId && o.type === 'image'),
  );
  const update = (p: Partial<CropState>) => useUi.setState({ crop: { ...crop, ...p } });

  const setMode = (mode: CropMode) => {
    update({ mode, targetId: null, rect: { ...canvas }, scalePct: 100 });
  };

  const setSize = (w: number, h: number, which: 'w' | 'h') => {
    const ratio = crop.rect.w / crop.rect.h;
    if (crop.lockRatio) {
      if (which === 'w') h = Math.round(w / ratio);
      else w = Math.round(h * ratio);
    }
    w = Math.max(1, w || 1);
    h = Math.max(1, h || 1);
    const rect = { ...crop.rect, w, h };
    update({ rect: image ? (intersect(rect, image) ?? crop.rect) : rect });
  };

  const scaled = scaledSize(canvas, crop.scalePct);

  return (
    <div className="cropbar" data-testid="cropbar">
      {crop.mode !== 'scale' && (
        <span
          className="crop-target"
          data-testid="crop-target"
          title="Click an image to crop that layer. Click outside the canvas to crop the canvas."
        >
          {image ? 'Image' : 'Canvas'}
        </span>
      )}
      <div className="segmented" role="tablist">
        {(['crop', 'scale'] as CropMode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={crop.mode === m}
            className={crop.mode === m ? 'on' : ''}
            onClick={() => setMode(m)}
          >
            {m === 'crop' ? 'Crop' : 'Scale'}
          </button>
        ))}
      </div>
      {crop.mode !== 'scale' ? (
        <div className="size-fields">
          <input
            type="number"
            aria-label="Width"
            value={crop.rect.w}
            min={1}
            onChange={(e) => setSize(+e.target.value, crop.rect.h, 'w')}
          />
          <span className="times">×</span>
          <input
            type="number"
            aria-label="Height"
            value={crop.rect.h}
            min={1}
            onChange={(e) => setSize(crop.rect.w, +e.target.value, 'h')}
          />
          <label title="Lock aspect ratio">
            <input
              type="checkbox"
              checked={crop.lockRatio}
              onChange={(e) => update({ lockRatio: e.target.checked })}
            />{' '}
            lock
          </label>
        </div>
      ) : (
        // Scale (Skitch's resize): the resulting pixel size, always proportional.
        <div className="size-fields">
          <input
            type="number"
            aria-label="Width"
            value={scaled.w}
            min={1}
            onChange={(e) => update({ scalePct: clampScale((+e.target.value / canvas.w) * 100) })}
          />
          <span className="times">×</span>
          <input
            type="number"
            aria-label="Height"
            value={scaled.h}
            min={1}
            onChange={(e) => update({ scalePct: clampScale((+e.target.value / canvas.h) * 100) })}
          />
        </div>
      )}
      <div className="crop-actions">
        <button className="pill" onClick={cancelCrop}>
          <Icon.close /> Cancel
        </button>
        <button className="pill primary" onClick={applyCrop}>
          <Icon.check /> Apply
        </button>
      </div>
    </div>
  );
}

const scaledSize = (canvas: { w: number; h: number }, pct: number) => ({
  w: Math.max(1, Math.round((canvas.w * pct) / 100)),
  h: Math.max(1, Math.round((canvas.h * pct) / 100)),
});

const SLIDER_MIN = 10;
const SLIDER_MAX = 200;
const STEP = 10;

/** Scale slider floating under the canvas while Crop › Scale is active (Skitch's resize slider). */
export function ScaleSlider() {
  const crop = useUi((s) => (s.tool === 'crop' && s.crop?.mode === 'scale' ? s.crop : null));
  if (!crop) return null;
  const pct = crop.scalePct;
  const set = (scalePct: number) => useUi.setState({ crop: { ...crop, scalePct: clampScale(scalePct) } });
  return (
    <div className="scale-slider" role="group" aria-label="Scale">
      <button
        className="iconbtn"
        aria-label="Scale down"
        title="Scale down"
        disabled={pct <= MIN_SCALE}
        onClick={() => set(Math.ceil(pct / STEP - 1) * STEP)}
      >
        −
      </button>
      <input
        type="range"
        aria-label="Scale percent"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        value={Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, Math.round(pct)))}
        onChange={(e) => set(+e.target.value)}
        onDoubleClick={() => set(100)}
      />
      <button
        className="iconbtn"
        aria-label="Scale up"
        title="Scale up"
        disabled={pct >= MAX_SCALE}
        onClick={() => set(Math.floor(pct / STEP + 1) * STEP)}
      >
        +
      </button>
      <span className="pct">{Math.round(pct)}%</span>
    </div>
  );
}
