import { useEffect, useRef } from 'react';
import { openWithDialog, startCapture } from '../actions/files';
import { newBlank, pasteFromClipboard, recoverLastCapture } from '../actions/image';
import { usePrefs, type CaptureAction } from '../state/prefs';
import { useUi } from '../state/ui';
import { Icon } from './icons';
import { kb } from './keys';
import { MenuItem, Popover } from './Popover';

const actions: { id: CaptureAction; label: string; run: () => unknown; shortcut?: string }[] = [
  { id: 'crosshair', label: 'Screen Snap', run: () => startCapture('crosshair'), shortcut: '5' },
  { id: 'timed', label: 'Timed Screen Snap', run: () => startCapture('timed'), shortcut: '6' },
  { id: 'fullscreen', label: 'Fullscreen Snap', run: () => startCapture('fullscreen'), shortcut: '7' },
  { id: 'window', label: 'Window Snap', run: () => startCapture('window'), shortcut: '8' },
  { id: 'blank', label: 'Blank Canvas', run: newBlank },
  { id: 'clipboard', label: 'From Clipboard', run: pasteFromClipboard },
  { id: 'open', label: 'Open File…', run: openWithDialog },
];

/** The arrow selects the next action; the main button performs it. */
export function CaptureButton() {
  const selected = usePrefs((s) => s.captureAction);
  const update = usePrefs((s) => s.update);
  const open = useUi((s) => s.popover === 'snap');
  const set = useUi((s) => s.set);
  const arrow = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const action = actions.find((a) => a.id === selected) ?? actions[0];
  const close = () => {
    set({ popover: null });
    arrow.current?.focus();
  };
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  return (
    <>
      <div className="capture-split" role="group" aria-label="Capture action">
        <button
          className="pill capture-button"
          title={action.label}
          onClick={() => {
            set({ popover: null });
            void action.run();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            if (e.altKey && e.key === 'ArrowDown') {
              e.preventDefault();
              e.stopPropagation();
              set({ popover: 'snap' });
            }
          }}
        >
          <Icon.camera /> {action.label}
        </button>
        <button
          ref={arrow}
          className="pill capture-options"
          aria-label="Choose capture action"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'capture-action-menu' : undefined}
          title="Choose capture action"
          onClick={() => set({ popover: open ? null : 'snap' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              set({ popover: 'snap' });
            }
          }}
        >
          <span className="caret" aria-hidden>
            ▼
          </span>
        </button>
      </div>
      {open && (
        <Popover anchor={arrow.current} placement="below" className="menu" onClose={close}>
          <div
            ref={menu}
            id="capture-action-menu"
            role="menu"
            aria-label="Capture action"
            onKeyDown={(e) => {
              e.stopPropagation();
              const buttons = Array.from(
                menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              );
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              let next: number;
              if (e.key === 'ArrowDown') next = (index + 1) % buttons.length;
              else if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = buttons.length - 1;
              else {
                if (e.key === 'Tab') close();
                return;
              }
              e.preventDefault();
              buttons[next].focus();
            }}
          >
            {actions.map((item) => (
              <MenuItem
                key={item.id}
                label={item.label}
                checked={action.id === item.id}
                kbd={item.shortcut ? kb(item.shortcut, { shift: true, ctrl: true }) : undefined}
                onClick={() => {
                  update({ captureAction: item.id });
                  close();
                }}
              />
            ))}
            <hr />
            <MenuItem
              label="Recover Last Capture"
              onClick={() => {
                close();
                void recoverLastCapture();
              }}
            />
            <MenuItem
              label="Preferences…"
              kbd={kb(',')}
              onClick={() => {
                close();
                set({ prefsOpen: true });
              }}
            />
          </div>
        </Popover>
      )}
    </>
  );
}
