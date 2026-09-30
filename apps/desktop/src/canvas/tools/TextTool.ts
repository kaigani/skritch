import { addObjects, newId } from '../../model/commands/document';
import type { Pt, TextObject } from '../../model/types';
import { docState } from '../../state/document';
import { ui, useUi } from '../../state/ui';
import { hitTop } from '../hitTest';
import type { Renderer } from '../Renderer';
import { TEXT_SIZES } from './DrawTools';
import { SelectTool } from './SelectTool';
import type { PointerInfo, Tool } from './Tool';

/**
 * Click to place text; click an existing text object to edit it. Editing happens in a real
 * <textarea> (ui/TextEditor) positioned over the canvas; commit on blur/Esc/⌘⏎.
 */
export class TextTool implements Tool {
  cursor = 'text';
  private select: SelectTool;
  private delegating = false;

  constructor(private r: Renderer) {
    this.select = new SelectTool(r);
  }

  onDown(p: PointerInfo): void {
    const doc = docState().doc!;
    const hit = hitTop(doc, p.doc, this.r.tol());
    if (hit && hit.type === 'text') {
      docState().select([hit.id]);
      useUi.setState({ editingTextId: hit.id });
      return;
    }
    if (this.select.wouldGrab(p, true)) {
      this.delegating = true;
      this.select.onDown(p);
      return;
    }
    const fontSize = Math.round(TEXT_SIZES[ui().size - 1] / Math.min(1, this.r.zoom));
    const pos: Pt = { x: p.doc.x, y: p.doc.y - fontSize * 0.6 };
    const obj: TextObject = { id: newId(), type: 'text', pos, text: '', color: ui().color, fontSize };
    // added with a coalesce key so typing merges into the same undo step
    docState().execute({ ...addObjects([obj]), coalesceKey: `text:${obj.id}` });
    docState().select([obj.id]);
    useUi.setState({ editingTextId: obj.id });
  }

  onMove(p: PointerInfo): void {
    if (this.delegating) this.select.onMove(p);
  }

  onUp(): void {
    if (this.delegating) {
      this.delegating = false;
      this.select.onUp();
    }
  }

  hoverCursor(p: PointerInfo): string {
    const hit = hitTop(docState().doc!, p.doc, this.r.tol());
    if (hit?.type === 'text') return 'text';
    return this.select.wouldGrab(p, true) ? this.select.hoverCursor(p) : this.cursor;
  }

  onContextMenu(p: PointerInfo, client: Pt): void {
    this.select.onContextMenu(p, client);
  }

  cancel(): void {
    this.select.cancel();
  }
}
