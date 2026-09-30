import { ipc, type CaptureKind } from '../ipc';
import { renderer } from '../canvas/Renderer';
import { bitmaps, docState, ensureBitmaps } from '../state/document';
import { askConfirm, ui, type ToolId } from '../state/ui';
import { usePrefs } from '../state/prefs';
import { video } from '../state/video';
import { addObjects, newId, removeObjects, reorder, type ZOrder } from '../model/commands/document';
import { translated } from '../model/objects';
import type { Document, ImageObject } from '../model/types';
import { deserializeDocument, hydrateDocument, serializeDocument } from '../export/serialize';
import { flattenToCanvas } from '../export/flatten';
import { canvasToBytes, context2d, makeCanvas } from '../util/canvas';
import { openWithDialog, startCapture } from './files';
import {
  assetFromBytes,
  confirmDiscard,
  copyAsFile,
  copyImage,
  encodeDocument,
  newBlank,
  pasteFromClipboard,
  recoverLastCapture,
  save,
  saveAs,
  saveProject,
} from './image';
import { confirmCloseVideo, saveVideoProject } from './video';

const CLIPBOARD_PREFIX = 'Skritch objects\n';

async function copySelection(cut = false) {
  const { doc, selection } = docState();
  if (!doc) return;
  if (!selection.length) return copyImage();
  const objects = doc.objects.filter((o) => selection.includes(o.id));
  const assets = Object.fromEntries(
    Object.entries(doc.assets).filter(([id]) => objects.some((o) => o.type === 'image' && o.assetId === id)),
  );
  const serialized = serializeDocument({ ...doc, objects, assets });
  if (JSON.parse(serialized).assetsOmitted)
    throw new Error('Selection is too large to copy as editable layers. Use Copy Image instead.');
  await ipc.clipboardWriteText(CLIPBOARD_PREFIX + serialized);
  if (cut && docState().doc === doc)
    docState().execute(removeObjects(objects.filter((o) => !o.locked).map((o) => o.id)));
}
export async function pasteObjectsOrImage() {
  const text = await ipc.clipboardReadText().catch(() => null);
  const doc = docState().doc;
  if (doc && text?.startsWith(CLIPBOARD_PREFIX)) {
    const copied = hydrateDocument(deserializeDocument(text.slice(CLIPBOARD_PREFIX.length)));
    if (copied) {
      await ensureBitmaps(copied.assets);
      if (docState().doc !== doc) return;
      const objects = copied.objects.map((o) => ({ ...translated(o, 16, 16), id: newId() }));
      docState().execute(addObjects(objects, Object.values(copied.assets)));
      docState().select(objects.map((o) => o.id));
      return;
    }
  }
  await pasteFromClipboard();
}

/** Image transforms operate on the selected image, or the composite when nothing is selected. */
export async function transformImage(kind: 'flip-h' | 'flip-v' | 'rotate-cw' | 'rotate-ccw') {
  const { doc, selection } = docState();
  if (!doc || ui().mode !== 'image') return;
  const image = doc.objects.find(
    (o): o is ImageObject => o.type === 'image' && !o.locked && selection.includes(o.id),
  );
  const frame = image ?? doc.canvas;
  const source: Document = image
    ? {
        ...doc,
        canvas: { x: image.x, y: image.y, w: image.w, h: image.h },
        objects: [image],
        background: { kind: 'transparent' },
      }
    : doc;
  const flat = flattenToCanvas(source, (id) => bitmaps.get(id));
  const rotate = kind.startsWith('rotate');
  const out = makeCanvas(rotate ? flat.height : flat.width, rotate ? flat.width : flat.height);
  const g = context2d(out);
  g.translate(out.width / 2, out.height / 2);
  if (rotate) g.rotate(kind === 'rotate-cw' ? Math.PI / 2 : -Math.PI / 2);
  else g.scale(kind === 'flip-h' ? -1 : 1, kind === 'flip-v' ? -1 : 1);
  g.drawImage(flat, -flat.width / 2, -flat.height / 2);
  const asset = await assetFromBytes(await canvasToBytes(out));
  if (docState().doc !== doc) return;
  const result: ImageObject = {
    id: image?.id ?? newId(),
    type: 'image',
    assetId: asset.id,
    x: frame.x,
    y: frame.y,
    w: out.width,
    h: out.height,
    opacity: 1,
  };
  docState().execute({
    name: rotate ? 'Rotate image' : 'Flip image',
    apply(d) {
      d.assets[asset.id] = asset;
      if (image) d.objects = d.objects.map((o) => (o.id === image.id ? result : o));
      else {
        d.objects = [result];
        d.canvas = { x: frame.x, y: frame.y, w: result.w, h: result.h };
      }
    },
  });
  docState().seal();
}

async function printImage() {
  const doc = docState().doc;
  if (!doc) return;
  const url = URL.createObjectURL(new Blob([await encodeDocument(doc, 'png')], { type: 'image/png' }));
  const image = document.createElement('img');
  image.className = 'print-document';
  image.src = url;
  document.body.append(image);
  await image.decode();
  // Native print dialogs may return before the sheet closes. Keep the printable image until the
  // next print job or afterprint, rather than revoking a source the print operation is still using.
  for (const old of document.querySelectorAll<HTMLImageElement>('.print-document')) {
    if (old !== image) {
      URL.revokeObjectURL(old.src);
      old.remove();
    }
  }
  await ipc.printDocument();
}

export async function handleMenuAction(action: string): Promise<void> {
  const active = document.activeElement as HTMLElement | null;
  if (active?.matches('input,textarea,[contenteditable="true"]')) {
    const command = (
      {
        undo: 'undo',
        redo: 'redo',
        cut: 'cut',
        copy: 'copy',
        clipboard: 'paste',
        delete: 'delete',
        'select-all': 'selectAll',
      } as Record<string, string>
    )[action];
    if (command) {
      if (action === 'clipboard')
        document.execCommand('insertText', false, (await ipc.clipboardReadText()) ?? '');
      else if (action === 'copy' || action === 'cut') {
        const input = active as HTMLInputElement;
        const text =
          typeof input.selectionStart === 'number'
            ? input.value.slice(input.selectionStart, input.selectionEnd ?? input.selectionStart)
            : (window.getSelection()?.toString() ?? '');
        await ipc.clipboardWriteText(text);
        if (action === 'cut') document.execCommand('delete');
      } else document.execCommand(command);
      return;
    }
  }
  ui().set({ popover: null });
  if (action.startsWith('capture-')) {
    const kind = action.slice(8);
    if (kind === 'menu') ui().toast('Select the menu area, then open the menu during the countdown.');
    await startCapture((kind === 'menu' ? 'timed' : kind) as CaptureKind);
    return;
  }
  if (action.startsWith('tool-')) {
    if (ui().mode === 'image' && docState().doc) ui().setTool(action.slice(5) as ToolId);
    return;
  }
  const d = docState();
  const isVideo = ui().mode === 'video';
  if (['order-front', 'order-forward', 'order-backward', 'order-back'].includes(action)) {
    if (ui().mode !== 'image' || !d.doc) return;
    const ids = d.doc.objects
      .filter((o) => d.selection.includes(o.id) && !o.locked && !o.hidden)
      .map((o) => o.id);
    if (ids.length) {
      d.execute(reorder(ids, action.slice(6) as ZOrder));
      d.seal();
    }
    return;
  }
  switch (action) {
    case 'blank':
      return newBlank();
    case 'open':
      return openWithDialog();
    case 'clipboard':
      return pasteObjectsOrImage();
    case 'prefs':
      ui().set({ prefsOpen: true });
      return;
    case 'recover':
      return recoverLastCapture();
    case 'save':
      if (isVideo) await saveVideoProject();
      else await save();
      return;
    case 'save-as':
      if (isVideo) await saveVideoProject();
      else await saveAs();
      return;
    case 'save-project':
      return isVideo ? saveVideoProject() : saveProject();
    case 'export':
      if (isVideo) ui().set({ exportVideoOpen: true });
      else await saveAs(ui().dragFormat);
      return;
    case 'copy':
      return copySelection();
    case 'cut':
      return copySelection(true);
    case 'copy-image':
      return copyImage();
    case 'copy-file':
      return copyAsFile();
    case 'undo':
      if (isVideo) video().undo();
      else d.undo();
      return;
    case 'redo':
      if (isVideo) video().redo();
      else d.redo();
      return;
    case 'delete':
      d.execute(removeObjects(d.selection.filter((id) => !d.doc?.objects.find((o) => o.id === id)?.locked)));
      return;
    case 'select-all':
      d.select(d.doc?.objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id) ?? []);
      return;
    case 'clear-annotations':
      d.execute(
        removeObjects(d.doc?.objects.filter((o) => o.type !== 'image' && !o.locked).map((o) => o.id) ?? []),
      );
      return;
    case 'zoom-in':
      renderer?.zoomStep(1);
      return;
    case 'zoom-out':
      renderer?.zoomStep(-1);
      return;
    case 'actual-size':
      renderer?.setZoom(1);
      return;
    case 'fit':
      renderer?.fit();
      return;
    case 'flip-h':
    case 'flip-v':
    case 'rotate-cw':
    case 'rotate-ccw':
      return transformImage(action);
    case 'print':
      return printImage();
    case 'page-setup':
      return ipc.pageSetup();
    case 'close':
      if (isVideo ? await confirmCloseVideo() : await confirmDiscard()) {
        await ipc.closeWindow();
      }
      return;
    case 'help':
      usePrefs.getState().update({ firstRunTipDismissed: false });
      await askConfirm({
        title: 'Skritch Help',
        message:
          'Use Screen Snap to capture, or its arrow to choose another action. Mark up with the tools on the left. On a multi-image canvas, Crop targets the selected image; click another image to switch, or click outside the canvas to crop the canvas. Drag Me exports the chosen file format. Capture shortcuts: Control–Shift–5 through 8.',
        buttons: [{ label: 'OK', value: 'ok', primary: true }],
      });
      return;
  }
}

let lastMenuState = '';
export function refreshMenuState() {
  lastMenuState = '';
  syncMenuState();
}

/** Keep native menu availability in step with the focused editor. */
export function syncMenuState() {
  const d = docState();
  const image = ui().mode === 'image' && !!d.doc;
  const isVideo = ui().mode === 'video';
  const any = image || (isVideo && !!video().project);
  const typing = !!document.activeElement?.matches('input,textarea,[contenteditable="true"]');
  const enabled: Record<string, boolean> = {
    copy: image || typing,
    cut: (image && d.selection.length > 0) || typing,
    delete: (image && d.selection.length > 0) || typing,
    'select-all': image || typing,
    undo: isVideo ? video().canUndo : d.canUndo,
    redo: isVideo ? video().canRedo : d.canRedo,
    save: any,
    'save-as': any,
    export: any,
    'save-project': any,
  };
  for (const id of [
    'copy-image',
    'copy-file',
    'clear-annotations',
    'zoom-in',
    'zoom-out',
    'actual-size',
    'fit',
    'flip-h',
    'flip-v',
    'rotate-cw',
    'rotate-ccw',
    'print',
  ])
    enabled[id] = image;
  for (const id of ['select', 'arrow', 'text', 'shape', 'pen', 'highlight', 'stamp', 'pixelate', 'crop'])
    enabled[`tool-${id}`] = image;
  const objects = image ? (d.doc?.objects ?? []) : [];
  const selected = new Set(
    objects.filter((o) => d.selection.includes(o.id) && !o.locked && !o.hidden).map((o) => o.id),
  );
  enabled['order-front'] = enabled['order-forward'] = objects.some(
    (o, i) => selected.has(o.id) && i < objects.length - 1 && !selected.has(objects[i + 1].id),
  );
  enabled['order-back'] = enabled['order-backward'] = objects.some(
    (o, i) => selected.has(o.id) && i > 0 && !selected.has(objects[i - 1].id),
  );
  // Text editors also use Cut/Copy/Paste/Undo; their native focus can change independently of the canvas.
  if (document.activeElement?.matches('input,textarea,[contenteditable="true"]')) {
    enabled.undo = true;
    enabled.redo = true;
  }
  const encoded = JSON.stringify(enabled);
  if (encoded === lastMenuState) return;
  lastMenuState = encoded;
  void ipc.menuSetEnabled(enabled).catch(() => {
    lastMenuState = '';
  });
}
