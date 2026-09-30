import { create } from 'zustand';
import type { ImageFormat } from '../ipc';
import type { Rect, ShapeKind, StampGlyph } from '../model/types';
import { DEFAULT_COLOR } from '../model/types';

export type ToolId =
  'select' | 'arrow' | 'text' | 'shape' | 'pen' | 'highlight' | 'stamp' | 'pixelate' | 'crop';
export type ShapeTool = ShapeKind | 'line';
export type CropMode = 'crop' | 'canvas' | 'scale';
export type AppMode = 'empty' | 'image' | 'video';

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  kind?: 'info' | 'error';
}

export interface CropState {
  /** Null/omitted targets the canvas; otherwise crop only this image layer. */
  targetId?: string | null;
  mode: CropMode;
  rect: Rect;
  lockRatio: boolean;
  anchor: number;
  scalePct: number;
}

export interface ConfirmDialog {
  title: string;
  message: string;
  buttons: { label: string; value: string; primary?: boolean; cancel?: boolean }[];
  resolve: (value: string) => void;
}

/** Items waiting for the arrival dialog (§5.1). */
export interface Arrival {
  kind: 'image' | 'video';
  label: string;
  resolve: (choice: 'cancel' | 'replace' | 'add' | 'newWindow') => void;
}

interface UiState {
  mode: AppMode;
  tool: ToolId;
  shape: ShapeTool;
  stamp: StampGlyph;
  color: string;
  size: number;
  zoom: number;
  /** True until the user zooms manually; the view re-fits on window resize while true. */
  autoFit: boolean;
  dragFormat: ImageFormat;
  crop: CropState | null;
  arrival: Arrival | null;
  toasts: Toast[];
  popover: null | 'color' | 'shape' | 'stamp' | 'snap' | 'share' | 'format' | 'clips';
  dropHover: boolean;
  prefsOpen: boolean;
  exportVideoOpen: boolean;
  /** Frame-edit mode stack (§6.7): true while an image document was opened from a video frame. */
  frameEdit: boolean;
  editingTextId: string | null;
  timedCountdown: number | null;
  contextMenu: { x: number; y: number } | null;
  /** Bumped on zoom/pan so DOM overlays (text editor) can follow the canvas. */
  viewRev: number;
  confirm: ConfirmDialog | null;
  busy: string | null;

  set(p: Partial<UiState>): void;
  setTool(t: ToolId): void;
  toast(text: string, opts?: Omit<Toast, 'id' | 'text'>): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  mode: 'empty',
  tool: 'arrow',
  shape: 'rect',
  stamp: 'check',
  color: DEFAULT_COLOR,
  size: 3,
  zoom: 1,
  autoFit: true,
  dragFormat: 'png',
  crop: null,
  arrival: null,
  toasts: [],
  popover: null,
  dropHover: false,
  prefsOpen: false,
  exportVideoOpen: false,
  frameEdit: false,
  editingTextId: null,
  timedCountdown: null,
  contextMenu: null,
  viewRev: 0,
  confirm: null,
  busy: null,

  set: (p) => set(p),
  setTool: (t) => {
    if (get().tool === t) return;
    set({ tool: t, popover: null, crop: t === 'crop' ? get().crop : null });
  },
  toast: (text, opts = {}) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, ...opts }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const ui = () => useUi.getState();

export function askConfirm(d: Omit<ConfirmDialog, 'resolve'>): Promise<string> {
  return new Promise((resolve) =>
    useUi.setState({
      confirm: {
        ...d,
        resolve: (v) => {
          useUi.setState({ confirm: null });
          resolve(v);
        },
      },
    }),
  );
}

export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Something went wrong';
}
