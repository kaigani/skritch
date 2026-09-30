import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initBackend, isTauri } from './ipc';
import { isMac } from './ui/keys';

// macOS uses an overlay title bar: the traffic lights sit inside the Skitch top bar (CSS makes room).
if (isTauri && isMac) document.documentElement.classList.add('platform-mac');
import { App } from './App';

// Dev-only hooks for Playwright (never shipped: import.meta.env.DEV is false in builds).
if (import.meta.env.DEV) {
  void Promise.all([
    import('./state/document'),
    import('./actions/image'),
    import('./export/png-metadata'),
  ]).then(
    ([d, img, png]) =>
      ((window as any).__skritch = { docState: d.docState, encodeDocument: img.encodeDocument, png }),
  );
}

void initBackend().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
