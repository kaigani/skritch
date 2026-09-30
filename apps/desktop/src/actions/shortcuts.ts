// Keyboard shortcuts (§1.3). One window-level handler, routed by mode.
import { renderer, isTyping } from '../canvas/Renderer';
import {
  duplicate,
  extendCanvasToFit,
  moveObjects,
  removeObjects,
  reorder,
} from '../model/commands/document';
import { docState } from '../state/document';
import { ui, useUi, type ToolId } from '../state/ui';
import { edl, useVideo, video } from '../state/video';
import { seqLength } from '../model/edl';
import { openWithDialog } from './files';
import { copyImage, newBlank, save, saveAs } from './image';
import { backToVideo, editFrameAsImage, exportFramePng } from './video';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  a: 'arrow',
  t: 'text',
  s: 'shape',
  p: 'pen',
  h: 'highlight',
  k: 'stamp',
  b: 'pixelate',
  c: 'crop',
};

export function duplicateSelection(): void {
  const { doc, selection } = docState();
  if (!doc || !selection.length) return;
  const { cmd, newIds } = duplicate(doc, selection);
  const key = `dup:${newIds[0]}`;
  docState().execute({ ...cmd, coalesceKey: key });
  docState().execute(extendCanvasToFit(newIds, key));
  docState().seal();
  docState().select(newIds);
}

let lastStep = 0;

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const s = ui();
    if (s.arrival || s.confirm || s.prefsOpen || s.exportVideoOpen || s.editingTextId) return;
    if (isTyping(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const handled = s.mode === 'video' ? videoKey(e, mod, k) : imageKey(e, mod, k);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onDup = () => duplicateSelection();
  window.addEventListener('keydown', onKey);
  window.addEventListener('skritch:duplicate', onDup);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('skritch:duplicate', onDup);
  };
}

function globalKey(mod: boolean, k: string, e: KeyboardEvent): boolean {
  if (mod && k === 'o') return (void openWithDialog(), true);
  if (mod && k === ',') return (useUi.setState({ prefsOpen: true }), true);
  if (mod && k === 'n' && !e.shiftKey) return (void newBlank(), true);
  return false;
}

function imageKey(e: KeyboardEvent, mod: boolean, k: string): boolean {
  if (globalKey(mod, k, e)) return true;
  const d = docState();
  if (!d.doc) return false;
  if (renderer?.tool.onKey?.(e)) return true;

  if (mod) {
    if (k === 'z') return (e.shiftKey ? d.redo() : d.undo(), true);
    if (k === 'y') return (d.redo(), true);
    if (k === 's') return (void (e.shiftKey ? saveAs() : save()), true);
    if (k === 'e') return (void saveAs('png'), true);
    if (k === 'c') return (void copyImage(), true);
    if (k === 'a') return (d.select(d.doc.objects.filter((o) => !o.locked).map((o) => o.id)), true);
    if (k === 'd') return (duplicateSelection(), true);
    if (k === '=' || k === '+') return (renderer?.zoomStep(1), true);
    if (k === '-') return (renderer?.zoomStep(-1), true);
    if (k === '0') return (renderer?.fit(), true);
    if (k === '1') return (renderer?.setZoom(1), true);
    if (e.code === 'BracketRight' && d.selection.length)
      return (d.execute(reorder(d.selection, e.shiftKey ? 'front' : 'forward')), true);
    if (e.code === 'BracketLeft' && d.selection.length)
      return (d.execute(reorder(d.selection, e.shiftKey ? 'back' : 'backward')), true);
    return false;
  }

  if ((k === 'delete' || k === 'backspace') && d.selection.length)
    return (d.execute(removeObjects(d.selection)), true);
  if (k.startsWith('arrow') && d.selection.length) {
    const step = e.shiftKey ? 10 : 1;
    const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
    const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
    const key = `nudge:${d.selection.join(',')}`;
    d.execute(moveObjects(d.selection, dx, dy, key));
    d.execute(extendCanvasToFit(d.selection, key));
    return true;
  }
  if (k === 'escape') {
    if (d.selection.length) return (d.select([]), true);
    if (ui().frameEdit) return (void backToVideo(), true);
    return false;
  }
  if (!e.altKey && TOOL_KEYS[k]) return (ui().setTool(TOOL_KEYS[k]), true);
  return false;
}

function videoKey(e: KeyboardEvent, mod: boolean, k: string): boolean {
  if (globalKey(mod, k, e)) return true;
  const v = video();
  if (!v.project) return false;
  const len = seqLength(v.project.sequence);
  const step = (n: number) => {
    // held arrows auto-repeat at 12 fps (§6.4)
    if (e.repeat && performance.now() - lastStep < 1000 / 12) return;
    lastStep = performance.now();
    useVideo.setState({ playing: false });
    v.setPlayhead(v.playhead + n);
  };

  if (mod) {
    if (k === 'z') return (e.shiftKey ? v.redo() : v.undo(), true);
    if (k === 'y') return (v.redo(), true);
    if (k === 'x') return (edl.cut(), true);
    if (k === 'c') return (edl.copy(), true);
    if (k === 'v') return (edl.paste(), true);
    if (k === 'k') return (edl.split(), true);
    if (k === 't' && e.shiftKey) return (edl.trimToRange(), true);
    if (k === 'e')
      return (e.shiftKey ? void exportFramePng() : useUi.setState({ exportVideoOpen: true }), true);
    if (k === 's') return (useUi.setState({ exportVideoOpen: true }), true);
    if (k === 'enter') return (void editFrameAsImage(), true);
    if (k === 'b' && e.altKey) return (useUi.setState({ popover: 'clips' }), true);
    if (k === '0') return (v.set({ pxPerFrame: 0 }), true);
    return false;
  }
  if (e.code === 'Space') return (useVideo.setState({ playing: !v.playing }), true);
  if (k === 'arrowleft' || k === ',') return (step(e.shiftKey ? -10 : -1), true);
  if (k === 'arrowright' || k === '.') return (step(e.shiftKey ? 10 : 1), true);
  if (k === 'home') return (v.setPlayhead(0), true);
  if (k === 'end') return (v.setPlayhead(len - 1), true);
  if (k === 'i')
    return (
      e.shiftKey ? v.project.markers.in !== undefined && v.setPlayhead(v.project.markers.in) : edl.setIn(),
      true
    );
  if (k === 'o')
    return (
      e.shiftKey
        ? v.project.markers.out !== undefined && v.setPlayhead(v.project.markers.out - 1)
        : edl.setOut(),
      true
    );
  if (e.altKey && e.code === 'KeyX') return (edl.clearMarkers(), true);
  if (k === 'delete' || k === 'backspace') return (edl.deleteRange(), true);
  return false;
}
