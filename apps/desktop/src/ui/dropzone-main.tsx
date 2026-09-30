// Windows Drop Zone (§2.1, §6.9): a 120×120 always-on-top tile; files dropped on it are forwarded to the
// main window with source 'dropzone' (the notification-area icon can't be a drop target on Windows).
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/600.css';
import { Icon } from './icons';

function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    void (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const { emitTo } = await import('@tauri-apps/api/event');
      off = await getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'enter' || p.type === 'over') setOver(true);
        else if (p.type === 'leave') setOver(false);
        else if (p.type === 'drop') {
          setOver(false);
          void emitTo('main', 'files://dropped', { paths: p.paths, source: 'dropzone' });
        }
      });
    })();
    return () => off?.();
  }, []);
  return (
    <div
      data-tauri-drag-region
      style={{
        position: 'fixed',
        inset: 6,
        borderRadius: 22,
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        gap: 6,
        background: over ? 'rgba(255,47,146,0.95)' : 'rgba(40,40,42,0.88)',
        border: `2px dashed ${over ? '#fff' : 'rgba(255,255,255,0.35)'}`,
        color: '#fff',
        font: '600 11px Inter, system-ui, sans-serif',
        boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        transition: 'background .12s',
        cursor: 'grab',
      }}
    >
      <span data-tauri-drag-region>
        <Icon.logo size={44} />
      </span>
      <span data-tauri-drag-region>{over ? 'Release to open' : 'Drop files'}</span>
    </div>
  );
}

document.body.style.cssText = 'margin:0;background:transparent;overflow:hidden;user-select:none';
createRoot(document.getElementById('root')!).render(<DropZone />);
