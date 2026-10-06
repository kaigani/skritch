// Image-mode orchestration: arrival (§5.1), open/save/export (§4.4), clipboard, drag-out.
import JSZip from 'jszip';
import { ipc } from '../ipc';
import type { ImageFormat } from '../ipc';
import { renderer } from '../canvas/Renderer';
import {
  addObjects,
  documentFromImage,
  extendCanvasToFit,
  newDocument,
  newId,
  placeNewImage,
  renameDocument,
} from '../model/commands/document';
import { objectFrame } from '../model/objects';
import type { Asset, DocSource, Document, ImageObject } from '../model/types';
import { SKRITCH_KEY, readITXt } from '../export/png-metadata';
import { deserializeDocument, hydrateDocument } from '../export/serialize';
import { flattenJpeg, flattenPng } from '../export/flatten';
import { baseName, defaultFileStem, extOf, formatInfo, safeFileStem, sniffMime } from '../export/formats';
import { bitmaps, docState, ensureBitmaps, isDirty } from '../state/document';
import { askConfirm, errorText, ui, useUi } from '../state/ui';
import { newAreaBackground, prefs } from '../state/prefs';
import { canvasToBytes, context2d, makeCanvas } from '../util/canvas';
import { video } from '../state/video';

export interface IncomingImage {
  bytes: Uint8Array;
  name: string;
  source: DocSource;
  path?: string;
  capturedAt?: number;
}

/** Decodes bytes into an Asset; formats other than PNG/JPEG are converted to PNG. */
export async function assetFromBytes(bytes: Uint8Array): Promise<Asset> {
  const bmp = await createImageBitmap(new Blob([bytes]));
  let mime = sniffMime(bytes);
  let data = bytes;
  if (!mime) {
    const c = makeCanvas(bmp.width, bmp.height);
    context2d(c).drawImage(bmp, 0, 0);
    data = await canvasToBytes(c);
    mime = 'image/png';
  }
  const asset: Asset = { id: newId(), mime, width: bmp.width, height: bmp.height, bytes: data };
  bitmaps.set(asset.id, bmp);
  return asset;
}

/** A PNG exported by Skritch carries its editable document in an iTXt chunk (§4.4). */
async function documentFromBytes(img: IncomingImage): Promise<Document> {
  const meta = {
    title: img.path ? baseName(img.path) : safeFileStem(img.name, ipc.platform) || defaultFileStem(),
    ...(img.capturedAt ? { createdAt: new Date(img.capturedAt).toISOString() } : {}),
    source: img.source,
    sourcePath: img.path,
  };
  const json = readITXt(img.bytes, SKRITCH_KEY);
  if (json) {
    try {
      const serial = deserializeDocument(json);
      const hydrated = hydrateDocument(serial);
      if (hydrated) return { ...hydrated, id: newId(), meta: { ...hydrated.meta, ...meta } };
      // assets were too large to embed: the PNG itself becomes the single base image
      const base = await assetFromBytes(img.bytes);
      const annotations = serial.objects.filter((o) => o.type !== 'image');
      const doc = documentFromImage(base, meta);
      (doc.objects[0] as ImageObject).x = serial.canvas.x;
      (doc.objects[0] as ImageObject).y = serial.canvas.y;
      return {
        ...doc,
        canvas: serial.canvas,
        background: serial.background,
        objects: [...doc.objects, ...annotations],
      };
    } catch (e) {
      console.warn('Ignoring invalid skritch metadata', e);
    }
  }
  return documentFromImage(await assetFromBytes(img.bytes), meta);
}

/** Last discarded capture, recoverable for 10 minutes (§5.1 Cancel). */
let lastCapture: { img: IncomingImage; at: number } | null = null;
export const recoverableCapture = () =>
  lastCapture && Date.now() - lastCapture.at < 10 * 60_000 ? lastCapture.img : null;

/** Recover Last Capture: the in-memory copy, else the backend's (survives a webview reload). */
export async function recoverLastCapture(): Promise<void> {
  let img = recoverableCapture();
  if (!img) {
    const last = await ipc.captureLast().catch(() => null);
    if (last)
      img = {
        bytes: await ipc.fileRead(last.pngPath),
        name: defaultFileStem(new Date(last.capturedAt ?? Date.now()), last.windowTitle ?? 'Screenshot'),
        source: 'capture',
        capturedAt: last.capturedAt,
      };
  }
  if (img) await arriveImages([img]);
  else ui().toast('No capture to recover');
}

/**
 * Entry point for every image arrival: capture, paste, drop, open (§5.1). With a document open the
 * user chooses Replace / Add to Canvas / Cancel (or the remembered preference applies).
 */
export async function arriveImages(imgs: IncomingImage[]): Promise<void> {
  if (!imgs.length) return;
  if (imgs.some((i) => i.source === 'capture')) lastCapture = { img: imgs[0], at: Date.now() };
  const hasDoc = !!docState().doc && ui().mode === 'image';
  if (ui().mode === 'video' && !ui().frameEdit) {
    const v = await askConfirm({
      title: 'Open image?',
      message: 'This closes the current video project.',
      buttons: [
        { label: 'Cancel', value: 'cancel', cancel: true },
        { label: 'Open Image', value: 'replace', primary: true },
      ],
    });
    if (v !== 'replace') return;
    video().close();
  }
  if (!hasDoc) return replaceWith(imgs[0]);

  let choice = prefs().captureArrival as string;
  if (choice === 'ask') choice = await askArrival('image', imgs.length);
  if (choice === 'cancel') return;
  if (choice === 'add') return addToCanvas(imgs);
  // 'newWindow' opens in this window in v1 (see DECISIONS.md). Choosing Replace is the user's
  // decision to drop the current image, so it does not ask "Save changes?" again.
  return replaceWith(imgs[0]);
}

export function askArrival(
  kind: 'image' | 'video',
  count: number,
): Promise<'cancel' | 'replace' | 'add' | 'newWindow'> {
  return new Promise((resolve) =>
    useUi.setState({
      arrival: {
        kind,
        label:
          kind === 'video'
            ? 'New video ready'
            : count > 1
              ? `${count} new images ready`
              : 'New capture ready',
        resolve: (c) => {
          useUi.setState({ arrival: null });
          resolve(c);
        },
      },
    }),
  );
}

async function replaceWith(img: IncomingImage): Promise<void> {
  const doc = await documentFromBytes(img);
  await openDocument(doc, img.path && extOf(img.path) === 'png' ? img.path : null);
}

export async function openDocument(doc: Document, filePath: string | null = null): Promise<void> {
  await docState().open(doc, filePath);
  useUi.setState({ mode: 'image', crop: null, editingTextId: null });
  if (ui().tool === 'crop') ui().setTool('arrow');
}

/**
 * §5.1 Add to Canvas: each image becomes an ImageObject on top, selected, Select tool active;
 * centred in the viewport, cascaded 24 px; larger-than-canvas images extend the canvas immediately.
 */
export async function addToCanvas(imgs: IncomingImage[]): Promise<void> {
  const doc = docState().doc;
  if (!doc) return;
  const assets = await Promise.all(imgs.map((i) => assetFromBytes(i.bytes)));
  const center = renderer?.viewportCenterDoc() ?? {
    x: doc.canvas.x + doc.canvas.w / 2,
    y: doc.canvas.y + doc.canvas.h / 2,
  };
  const existing = doc.objects.map(objectFrame);
  const objs: ImageObject[] = assets.map((a, i) => {
    const pos = placeNewImage(doc.canvas, center, a.width, a.height, existing, i);
    return {
      id: newId(),
      type: 'image',
      assetId: a.id,
      x: pos.x,
      y: pos.y,
      w: a.width,
      h: a.height,
      opacity: 1,
    };
  });
  const key = `arrive:${newId()}`;
  docState().execute({ ...addObjects(objs, assets), name: 'Add to Canvas', coalesceKey: key });
  docState().execute(
    extendCanvasToFit(
      objs.map((o) => o.id),
      key,
    ),
  );
  docState().seal();
  ui().setTool('select');
  docState().select(objs.map((o) => o.id));
}

/** Standard "Save changes?" flow. Resolves true when it is OK to discard the current document. */
export async function confirmDiscard(): Promise<boolean> {
  if (!isDirty(docState())) return true;
  const v = await askConfirm({
    title: 'Save changes?',
    message: `Do you want to save the changes you made to “${docState().doc!.meta.title}”?`,
    buttons: [
      { label: 'Don’t Save', value: 'discard' },
      { label: 'Cancel', value: 'cancel', cancel: true },
      { label: 'Save…', value: 'save', primary: true },
    ],
  });
  if (v === 'cancel') return false;
  if (v === 'save') return save();
  return true;
}

export async function newBlank(): Promise<void> {
  if (ui().mode === 'image' && !(await confirmDiscard())) return;
  const doc = newDocument({
    canvas: { x: 0, y: 0, w: 800, h: 600 },
    background: newAreaBackground(),
    meta: {
      title: defaultFileStem(new Date(), 'Untitled'),
      createdAt: new Date().toISOString(),
      source: 'blank',
    },
  });
  await openDocument(doc);
}

const bitmapOf = (id: string) => bitmaps.get(id);

export async function encodeDocument(doc: Document, format: ImageFormat): Promise<Uint8Array> {
  await ensureBitmaps(doc.assets);
  if (format === 'png') return flattenPng(doc, bitmapOf);
  if (format === 'jpg') return flattenJpeg(doc, bitmapOf, 0.9);
  const png = await flattenPng(doc, bitmapOf, { embedDocument: false });
  return ipc.imageConvert(png, format, 0.9);
}

const joinPath = (dir: string, name: string) =>
  dir ? `${dir.replace(/[\\/]+$/, '')}${dir.includes('\\') ? '\\' : '/'}${name}` : name;

/** ⌘S: saves to the current file (PNG/JPG), otherwise behaves like Save As. */
export async function save(): Promise<boolean> {
  const { doc, filePath } = docState();
  if (!doc) return false;
  if (!filePath || safeFileStem(doc.meta.title, ipc.platform) !== baseName(filePath)) return saveAs();
  return writeImage(filePath);
}

export async function saveAs(format: ImageFormat = prefs().defaultFormat): Promise<boolean> {
  const doc = docState().doc;
  if (!doc) return false;
  const info = formatInfo(format);
  const stem = safeFileStem(doc.meta.title, ipc.platform) || defaultFileStem(new Date(doc.meta.createdAt));
  const path = await ipc.saveDialog({
    defaultPath: joinPath(prefs().defaultSaveDir, `${stem}.${info.ext}`),
    filters: [{ name: info.label, extensions: [info.ext] }],
  });
  if (!path) return false;
  return writeImage(path);
}

async function writeImage(path: string): Promise<boolean> {
  const doc = docState().doc!;
  const ext = extOf(path);
  const format = (['jpeg'].includes(ext) ? 'jpg' : ext === 'tif' ? 'tiff' : ext) as ImageFormat;
  try {
    const title = baseName(path);
    const exported = { ...doc, meta: { ...doc.meta, title } };
    const bytes = await encodeDocument(exported, formatInfo(format) ? format : 'png');
    await ipc.fileWrite(path, bytes);
    // only PNG round-trips the editable document, so only PNG becomes the file ⌘S writes back to
    if (docState().doc === doc) {
      if (title !== doc.meta.title) docState().execute(renameDocument(title));
      docState().markSaved(format === 'png' ? path : undefined);
    }
    ui().toast(`Saved ${path.split(/[\\/]/).pop()}`);
    return true;
  } catch (e) {
    ui().toast(`Couldn’t save: ${errorText(e)}`, { kind: 'error' });
    return false;
  }
}

export async function copyImage(): Promise<void> {
  const doc = docState().doc;
  if (!doc) return;
  try {
    await ipc.clipboardWriteImage(await encodeDocument(doc, 'png'));
    ui().toast('Copied image');
  } catch (e) {
    ui().toast(`Couldn’t copy: ${errorText(e)}`, { kind: 'error' });
  }
}

export async function copyAsFile(): Promise<void> {
  try {
    const path = await writeTempExport();
    if (!path) return;
    await ipc.clipboardWriteFiles([path]);
    ui().toast('Copied as file');
  } catch (e) {
    ui().toast(errorText(e), { kind: 'error' });
  }
}

export async function pasteFromClipboard(): Promise<void> {
  const bytes = await ipc.clipboardReadImage().catch(() => null);
  if (!bytes) {
    ui().toast('No image on the clipboard');
    return;
  }
  await arriveImages([{ bytes, name: 'Clipboard', source: 'clipboard' }]);
}

/** Writes the flattened image (in the Drag Me format) to a temp file and returns its path. */
export async function writeTempExport(format: ImageFormat = ui().dragFormat): Promise<string | null> {
  const doc = docState().doc;
  if (!doc) return null;
  const info = formatInfo(format);
  const stem = safeFileStem(doc.meta.title, ipc.platform) || defaultFileStem(new Date(doc.meta.createdAt));
  const bytes = await encodeDocument(doc, format);
  return ipc.tempWrite(`${stem}.${info.ext}`, bytes);
}

// ---- .skritch project (zip: manifest.json + assets/<id>.png) ---------------------------------------

export async function saveProject(): Promise<void> {
  const doc = docState().doc;
  if (!doc) return;
  const path = await ipc.saveDialog({
    defaultPath: joinPath(
      prefs().defaultSaveDir,
      `${safeFileStem(doc.meta.title, ipc.platform) || 'Untitled'}.skritch`,
    ),
    filters: [{ name: 'Skritch Project', extensions: ['skritch'] }],
  });
  if (!path) return;
  const zip = new JSZip();
  const { assets, ...rest } = doc;
  zip.file(
    'manifest.json',
    JSON.stringify({
      ...rest,
      assets: Object.fromEntries(
        Object.entries(assets).map(([k, a]) => [
          k,
          { id: a.id, mime: a.mime, width: a.width, height: a.height },
        ]),
      ),
    }),
  );
  for (const a of Object.values(assets))
    zip.file(`assets/${a.id}.${a.mime === 'image/png' ? 'png' : 'jpg'}`, a.bytes);
  await ipc.fileWrite(path, await zip.generateAsync({ type: 'uint8array' }));
  ui().toast('Project saved');
}

export async function openProjectBytes(bytes: Uint8Array, path: string): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as Document;
  for (const a of Object.values(manifest.assets)) {
    const f = zip.file(`assets/${a.id}.${a.mime === 'image/png' ? 'png' : 'jpg'}`);
    if (f) a.bytes = await f.async('uint8array');
  }
  await openDocument({ ...manifest, meta: { ...manifest.meta, title: baseName(path) } });
}
