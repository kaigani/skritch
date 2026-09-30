import { create } from 'zustand';
import { ipc } from '../ipc';
import type { CaptureKind, ImageFormat } from '../ipc';

export type CaptureArrival = 'ask' | 'replace' | 'add' | 'newWindow';
export type NewAreaFill = 'white' | 'transparent' | 'custom';
export type CaptureAction = CaptureKind | 'blank' | 'clipboard' | 'open';

export interface Prefs {
  captureAction: CaptureAction;
  captureArrival: CaptureArrival;
  newAreaFill: NewAreaFill;
  newAreaColor: string;
  defaultFormat: ImageFormat;
  defaultSaveDir: string;
  includeSkritchWindow: boolean;
  firstRunTipDismissed: boolean;
  videoAudio: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  captureAction: 'crosshair',
  captureArrival: 'ask',
  newAreaFill: 'white',
  newAreaColor: '#ffffff',
  defaultFormat: 'png',
  defaultSaveDir: '',
  includeSkritchWindow: false,
  firstRunTipDismissed: false,
  videoAudio: true,
};

interface PrefsState extends Prefs {
  loaded: boolean;
  load(): Promise<void>;
  update(p: Partial<Prefs>): void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...DEFAULT_PREFS,
  loaded: false,
  async load() {
    const stored = (await ipc.prefsGet<Partial<Prefs>>('prefs')) ?? {};
    const defaultSaveDir = stored.defaultSaveDir || (await ipc.defaultSaveDir().catch(() => ''));
    set({ ...DEFAULT_PREFS, ...stored, defaultSaveDir, loaded: true });
  },
  update(p) {
    set(p);
    const { loaded: _l, load: _a, update: _u, ...rest } = { ...get() };
    void ipc.prefsSet('prefs', rest);
  },
}));

export const prefs = () => usePrefs.getState();

/** Background colour for newly exposed canvas area (§5.2). */
export function newAreaBackground(p: Prefs = prefs()) {
  if (p.newAreaFill === 'transparent') return { kind: 'transparent' as const };
  return { kind: 'color' as const, color: p.newAreaFill === 'white' ? '#ffffff' : p.newAreaColor };
}
