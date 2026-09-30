import { useEffect, useRef } from 'react';
import { Player, player, setPlayer } from './Player';
import { useVideo } from '../state/video';

/** The stage canvas for Video mode: same gray backdrop as image mode, current frame letterboxed. */
export function VideoStage() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const p = player ?? new Player();
    setPlayer(p);
    const c = canvas.current!;
    const ro = new ResizeObserver(() => {
      const r = host.current!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      p.redraw();
    });
    ro.observe(host.current!);
    p.attach(c);
    p.show(useVideo.getState().playhead);
    return () => {
      ro.disconnect();
      p.attach(null);
    };
  }, []);

  return (
    <div
      ref={host}
      className="stage"
      data-testid="video-stage"
      onClick={() => useVideo.setState((s) => ({ playing: !s.playing }))}
    >
      <canvas ref={canvas} className="layer" />
    </div>
  );
}
