import { create } from 'zustand';
import { History, type Command } from '../model/commands/history';
import type { Asset, Document, Id } from '../model/types';

/** Decoded bitmaps for document assets, keyed by asset id. Runtime-only (not part of the document). */
export const bitmaps = new Map<Id, ImageBitmap>();

export async function ensureBitmaps(assets: Record<Id, Asset>): Promise<void> {
  await Promise.all(
    Object.values(assets)
      .filter((a) => !bitmaps.has(a.id))
      .map(async (a) => bitmaps.set(a.id, await createImageBitmap(new Blob([a.bytes], { type: a.mime })))),
  );
}

interface DocState {
  doc: Document | null;
  selection: Id[];
  /** Document snapshot at the last save — dirty = doc !== savedDoc. */
  savedDoc: Document | null;
  filePath: string | null;
  /** Bumped on every change so non-React consumers (renderer) can cheaply detect updates. */
  revision: number;
  canUndo: boolean;
  canRedo: boolean;

  open(doc: Document, filePath?: string | null): Promise<void>;
  close(): void;
  execute(cmd: Command<Document>): void;
  seal(): void;
  undo(): void;
  redo(): void;
  select(ids: Id[]): void;
  markSaved(filePath?: string): void;
}

const history = new History<Document | null>(null);

export const useDoc = create<DocState>((set, get) => {
  const sync = (extra: Partial<DocState> = {}) =>
    set((s) => ({
      doc: history.state,
      revision: s.revision + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      ...extra,
    }));
  const liveSelection = () => {
    const d = history.state;
    if (!d) return [];
    const ids = new Set(d.objects.map((o) => o.id));
    return get().selection.filter((id) => ids.has(id));
  };

  return {
    doc: null,
    selection: [],
    savedDoc: null,
    filePath: null,
    revision: 0,
    canUndo: false,
    canRedo: false,

    async open(doc, filePath = null) {
      await ensureBitmaps(doc.assets);
      history.reset(doc);
      sync({ selection: [], savedDoc: doc, filePath });
    },
    close() {
      history.reset(null);
      sync({ selection: [], savedDoc: null, filePath: null });
    },
    execute(cmd) {
      if (!history.state) return;
      history.execute(cmd as Command<Document | null>);
      sync({ selection: liveSelection() });
    },
    seal() {
      history.seal();
      set({ canUndo: history.canUndo });
    },
    undo() {
      history.undo();
      sync({ selection: liveSelection() });
    },
    redo() {
      history.redo();
      sync({ selection: liveSelection() });
    },
    select(ids) {
      set((s) => ({ selection: ids, revision: s.revision + 1 }));
    },
    markSaved(filePath) {
      set((s) => ({ savedDoc: s.doc, filePath: filePath ?? s.filePath }));
    },
  };
});

export const isDirty = (s: Pick<DocState, 'doc' | 'savedDoc'>) => s.doc !== null && s.doc !== s.savedDoc;
export const docState = () => useDoc.getState();
