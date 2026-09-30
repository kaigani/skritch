import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { removeObjects, reorder, updateObjects } from '../model/commands/document';
import { docState, useDoc } from '../state/document';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';
import { ipc } from '../ipc';
import { openWithDialog, startCapture } from '../actions/files';
import { newBlank, pasteFromClipboard } from '../actions/image';
import { Icon } from './icons';
import { MenuItem } from './Popover';
import { kb } from './keys';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Right-click menu for objects (§5.1): Bring to Front, Send to Back, Reset Size, Delete. */
export function ContextMenu() {
  const at = useUi((s) => s.contextMenu);
  const selection = useDoc((s) => s.selection);
  const doc = useDoc((s) => s.doc);
  const close = () => useUi.setState({ contextMenu: null });

  useEffect(() => {
    if (!at) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.menu')) close();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [at]);

  if (!at || !doc || !selection.length) return null;
  const images = doc.objects.filter((o) => selection.includes(o.id) && o.type === 'image');
  const run = (f: () => void) => () => {
    f();
    close();
  };
  return createPortal(
    <div className="menu" role="menu" style={{ position: 'fixed', left: at.x, top: at.y }}>
      <MenuItem
        label="Bring to Front"
        kbd={kb(']', { shift: true })}
        onClick={run(() => docState().execute(reorder(selection, 'front')))}
      />
      <MenuItem
        label="Bring Forward"
        kbd={kb(']')}
        onClick={run(() => docState().execute(reorder(selection, 'forward')))}
      />
      <MenuItem
        label="Send Backward"
        kbd={kb('[')}
        onClick={run(() => docState().execute(reorder(selection, 'backward')))}
      />
      <MenuItem
        label="Send to Back"
        kbd={kb('[', { shift: true })}
        onClick={run(() => docState().execute(reorder(selection, 'back')))}
      />
      <hr />
      <MenuItem
        label="Reset Size"
        disabled={!images.length}
        onClick={run(() =>
          docState().execute(
            updateObjects(
              images.map((o) => o.id),
              (o) => {
                if (o.type !== 'image') return o;
                const a = docState().doc!.assets[o.assetId];
                return { ...o, w: a.width, h: a.height };
              },
              'Reset Size',
            ),
          ),
        )}
      />
      <MenuItem
        label="Duplicate"
        kbd={kb('D')}
        onClick={run(() => window.dispatchEvent(new CustomEvent('skritch:duplicate')))}
      />
      <MenuItem label="Delete" kbd="⌫" onClick={run(() => docState().execute(removeObjects(selection)))} />
    </div>,
    document.body,
  );
}

/** Shown when no document is open. */
export function EmptyState() {
  return (
    <div className="empty">
      <div className="card">
        <Icon.logo size={64} />
        <h1>Make your point.</h1>
        <p>
          Snap a screen, drop an image or video, or paste with <kbd>{kb('V')}</kbd>.
          <br />
          Screen Snap is always a shortcut away: <kbd>{kb('5', { ctrl: true, shift: true })}</kbd>.
        </p>
        <div className="actions">
          <button className="pill snap" onClick={() => void startCapture('crosshair')}>
            <Icon.camera /> Screen Snap
          </button>
          <button className="pill" onClick={() => void newBlank()}>
            Blank Canvas
          </button>
          <button className="pill" onClick={() => void openWithDialog()}>
            Open…
          </button>
          <button className="pill" onClick={() => void pasteFromClipboard()}>
            Paste
          </button>
        </div>
      </div>
    </div>
  );
}

/** Single dismissible first-launch tip (§5.4). */
export function FirstRunTip() {
  const dismissed = usePrefs((s) => s.firstRunTipDismissed);
  const loaded = usePrefs((s) => s.loaded);
  if (!loaded || dismissed) return null;
  return (
    <div className="tip" role="note">
      <h3>Skritch lives in your {ipc.platform === 'mac' ? 'menu bar' : 'system tray'}</h3>
      <ul>
        <li>
          Snap anytime: <b>{kb('5', { ctrl: true, shift: true })}</b> region,{' '}
          <b>{kb('6', { ctrl: true, shift: true })}</b> timed, <b>{kb('7', { ctrl: true, shift: true })}</b>{' '}
          fullscreen, <b>{kb('8', { ctrl: true, shift: true })}</b> window.
        </li>
        <li>Drag the pink “Drag Me” tab into any app to share.</li>
        {ipc.platform === 'mac' && <li>Drop images or videos on the menu-bar icon to open them.</li>}
        {ipc.platform === 'windows' && (
          <li>Windows can’t drop onto tray icons — use “Show Drop Zone” from the tray menu instead.</li>
        )}
      </ul>
      <div className="buttons">
        <button className="pill" onClick={() => usePrefs.getState().update({ firstRunTipDismissed: true })}>
          Got it
        </button>
      </div>
    </div>
  );
}

export function DropHover() {
  const on = useUi((s) => s.dropHover);
  const mode = useUi((s) => s.mode);
  if (!on) return null;
  return <div className="drop-hover">{mode === 'video' ? 'Drop to append clips' : 'Drop to open'}</div>;
}

export function Busy() {
  const busy = useUi((s) => s.busy);
  const n = useUi((s) => s.timedCountdown);
  if (n !== null) return <div className="busy">Snapping in {n}…</div>;
  return busy ? <div className="busy">{busy}</div> : null;
}
