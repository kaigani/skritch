import { useEffect, useState } from 'react';
import { ipc } from '../ipc';
import { RegionOverlay } from './RegionOverlay';

/**
 * Overlay pages are created once (hidden, at app start) and reused: the backend announces each
 * capture with `capture://overlay-arm` and ends it with `capture://overlay-reset`. This keeps the
 * webview start-up and bundle load out of the click-to-selection latency.
 */
export function OverlayHost() {
  const display = Number(new URLSearchParams(location.search).get('display') ?? 0);
  const [session, setSession] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    const unlisten = [
      ipc.on<number>('capture://overlay-arm', (id) => setSession(id)),
      ipc.on('capture://overlay-reset', () => setSession(null)),
    ];
    // A capture may already be armed: the page was created on demand and missed the event.
    ipc
      .overlayInfo(display)
      .then((info) => !disposed && setSession((current) => current ?? info.session))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten.forEach((u) => void u.then((off) => off()));
    };
  }, [display]);

  return session === null ? null : <RegionOverlay key={session} display={display} />;
}
