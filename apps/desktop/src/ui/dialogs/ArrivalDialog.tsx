import { useCallback, useEffect, useState } from 'react';
import { usePrefs } from '../../state/prefs';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';

type Choice = 'cancel' | 'replace' | 'add';

/**
 * §5.1 "New capture ready" sheet: Cancel / Replace / Add to Canvas (default), with "Remember my choice".
 * Keyboard: Esc = Cancel, Enter = Add, R = Replace, A = Add. For videos, Add is disabled.
 */
export function ArrivalDialog() {
  const arrival = useUi((s) => s.arrival);
  const [remember, setRemember] = useState(false);
  const isVideo = arrival?.kind === 'video';

  useEffect(() => setRemember(false), [arrival]);

  const choose = useCallback(
    (c: Choice) => {
      if (!arrival) return;
      if (remember && c !== 'cancel' && !isVideo) usePrefs.getState().update({ captureArrival: c });
      arrival.resolve(c);
    },
    [arrival, remember, isVideo],
  );

  useEffect(() => {
    if (!arrival) return;
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') choose('cancel');
      else if (k === 'enter') choose(isVideo ? 'replace' : 'add');
      else if (k === 'r') choose('replace');
      else if (k === 'a' && !isVideo) choose('add');
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [arrival, choose, isVideo]);

  if (!arrival) return null;
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
      <div className="sheet">
        <div className="icon-row">
          <div className="thumb">
            <Icon.camera />
          </div>
          <div style={{ flex: 1 }}>
            <h2 id="arrival-title">{arrival.label}</h2>
            <p>
              {isVideo
                ? 'Opening a video replaces the current image.'
                : 'What would you like to do with the existing image?'}
            </p>
            {!isVideo && (
              <label className="row">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />{' '}
                Remember my choice
                <span style={{ color: '#888' }}>(change in Preferences)</span>
              </label>
            )}
          </div>
        </div>
        <div className="buttons">
          <button className="pill" onClick={() => choose('cancel')}>
            Cancel
          </button>
          <button className={`pill ${isVideo ? 'primary' : ''}`} onClick={() => choose('replace')}>
            {isVideo ? 'Replace (open video)' : 'Replace'}
          </button>
          <button
            className={`pill ${isVideo ? '' : 'primary'}`}
            disabled={isVideo}
            title={isVideo ? 'Videos open in Video mode' : 'Add as a movable layer (Enter)'}
            onClick={() => choose('add')}
          >
            Add to Canvas
          </button>
        </div>
      </div>
    </div>
  );
}
