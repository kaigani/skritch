import { useEffect } from 'react';
import { useUi } from '../../state/ui';
import { Icon } from '../icons';

export function ConfirmDialog() {
  const d = useUi((s) => s.confirm);

  useEffect(() => {
    if (!d) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') d.resolve(d.buttons.find((b) => b.cancel)?.value ?? 'cancel');
      else if (e.key === 'Enter') d.resolve(d.buttons.find((b) => b.primary)?.value ?? d.buttons[0].value);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [d]);

  if (!d) return null;
  return (
    <div className="scrim" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="sheet">
        <div className="icon-row">
          <div className="thumb">
            <Icon.logo size={40} />
          </div>
          <div>
            <h2 id="confirm-title">{d.title}</h2>
            <p>{d.message}</p>
          </div>
        </div>
        <div className="buttons">
          {d.buttons.map((b, i) => (
            <button
              key={b.value}
              className={`pill ${b.primary ? 'primary' : ''}`}
              style={i === 0 && d.buttons.length > 2 ? { marginRight: 'auto' } : undefined}
              onClick={() => d.resolve(b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
