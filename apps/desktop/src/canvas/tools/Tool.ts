import type { Document, Pt } from '../../model/types';

export interface PointerInfo {
  /** CSS px relative to the viewport */
  screen: Pt;
  /** document space */
  doc: Pt;
  shift: boolean;
  alt: boolean;
  /** ⌘ on macOS, Ctrl on Windows */
  mod: boolean;
  button: number;
  detail: number;
}

/** Strategy interface for canvas tools (§4.3). */
export interface Tool {
  cursor: string;
  onDown(p: PointerInfo): void;
  onMove(p: PointerInfo): void;
  onUp(p: PointerInfo): void;
  onDoubleClick?(p: PointerInfo): void;
  onContextMenu?(p: PointerInfo, client: Pt): void;
  /** Returns true if the key was handled. */
  onKey?(e: KeyboardEvent): boolean;
  hoverCursor?(p: PointerInfo): string;
  /** Draws on the interaction layer; `g` is in CSS px (use renderer transforms). */
  renderOverlay?(g: CanvasRenderingContext2D, doc: Document): void;
  cancel?(): void;
}
