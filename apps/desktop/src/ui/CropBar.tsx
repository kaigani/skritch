import { anchoredRect, intersect } from '../model/geometry';
import type { ImageObject } from '../model/types';
import { applyCrop, cancelCrop } from '../canvas/tools/CropTool';
import { docState, useDoc } from '../state/document';
import { useUi, type CropMode, type CropState } from '../state/ui';

/** Crop / Canvas / Scale segmented control shown in the top bar while the Crop tool is active (§5.3). */
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
    const base = crop.mode === 'canvas' ? docState().doc!.canvas : crop.rect;
    const rect = crop.mode === 'canvas' ? anchoredRect(base, w, h, crop.anchor) : { ...crop.rect, w, h };
    update({ rect: image ? (intersect(rect, image) ?? crop.rect) : rect });
  };

  const scaled = {
    w: Math.round((canvas.w * crop.scalePct) / 100),
    h: Math.round((canvas.h * crop.scalePct) / 100),
  };

  return (
    <div className="cropbar" data-testid="cropbar">
      <span
        className="crop-target"
        data-testid="crop-target"
        title="Click an image to crop that layer. Click outside the canvas to crop the canvas."
      >
        {image ? 'Image' : 'Canvas'}
      </span>
      <div className="segmented" role="tablist">
        {(['crop', 'canvas', 'scale'] as CropMode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={crop.mode === m}
            className={crop.mode === m ? 'on' : ''}
            onClick={() => setMode(m)}
          >
            {m === 'crop' ? 'Crop' : m === 'canvas' ? 'Canvas' : 'Scale'}
          </button>
        ))}
      </div>
      {crop.mode !== 'scale' ? (
        <>
          <label>
            W:{' '}
            <input
              type="number"
              aria-label="Width"
              value={crop.rect.w}
              min={1}
              onChange={(e) => setSize(+e.target.value, crop.rect.h, 'w')}
            />
          </label>
          <label>
            H:{' '}
            <input
              type="number"
              aria-label="Height"
              value={crop.rect.h}
              min={1}
              onChange={(e) => setSize(crop.rect.w, +e.target.value, 'h')}
            />
          </label>
          <label title="Lock aspect ratio">
            <input
              type="checkbox"
              checked={crop.lockRatio}
              onChange={(e) => update({ lockRatio: e.target.checked })}
            />{' '}
            lock
          </label>
          {crop.mode === 'canvas' && (
            <div className="anchor" title="Anchor" role="radiogroup" aria-label="Anchor">
              {Array.from({ length: 9 }, (_, i) => (
                <button
                  key={i}
                  className={crop.anchor === i ? 'on' : ''}
                  aria-label={`Anchor ${i + 1}`}
                  onClick={() =>
                    update({
                      anchor: i,
                      rect: anchoredRect(docState().doc!.canvas, crop.rect.w, crop.rect.h, i),
                    })
                  }
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <label>
            <input
              type="number"
              aria-label="Scale percent"
              value={crop.scalePct}
              min={1}
              max={1000}
              onChange={(e) => update({ scalePct: Math.max(1, +e.target.value || 1) })}
            />{' '}
            %
          </label>
          <span className="dim">
            → {scaled.w} × {scaled.h}
          </span>
        </>
      )}
      <button className="pill primary" onClick={applyCrop}>
        Apply
      </button>
      <button className="pill" onClick={cancelCrop}>
        Cancel
      </button>
    </div>
  );
}
