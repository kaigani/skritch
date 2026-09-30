import { useEffect, useRef } from 'react';
import { Renderer, setRenderer } from './Renderer';
import { useUi } from '../state/ui';

/** Mounts the imperative renderer; drawing never goes through React reconciliation (§2). */
export function CanvasView() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = new Renderer(host.current!);
    r.onViewChange = () => useUi.setState((s) => ({ viewRev: s.viewRev + 1 }));
    setRenderer(r);
    return () => {
      setRenderer(null);
      r.destroy();
    };
  }, []);
  return (
    <div
      ref={host}
      className="stage-layers"
      style={{ position: 'absolute', inset: 0 }}
      data-testid="canvas"
    />
  );
}
