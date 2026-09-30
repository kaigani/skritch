import { BRAND_PINK } from '../theme';

// Pure document model (§4.1). No DOM or Tauri imports allowed in model/.

export type Id = string;

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Background = { kind: 'transparent' } | { kind: 'color'; color: string };

export type DocSource = 'capture' | 'file' | 'clipboard' | 'blank' | 'video-frame';

export interface Document {
  id: Id;
  version: 1;
  /** Rect in document space; origin MAY be negative (§5.2). */
  canvas: Rect;
  background: Background;
  /** z-order: index 0 = bottom */
  objects: SkObject[];
  assets: Record<Id, Asset>;
  meta: { title: string; createdAt: string; source: DocSource; sourcePath?: string };
}

export interface Asset {
  id: Id;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** Encoded image bytes. At runtime the renderer keeps a decoded ImageBitmap keyed by id. */
  bytes: Uint8Array;
}

export interface BaseObject {
  id: Id;
  type: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface ImageObject extends BaseObject {
  type: 'image';
  assetId: Id;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** Visible area in original asset pixels. Omitted means the entire bitmap. */
  sourceRect?: Rect;
}
export interface ArrowObject extends BaseObject {
  type: 'arrow';
  from: Pt;
  to: Pt;
  color: string;
  size: number;
}
export interface LineObject extends BaseObject {
  type: 'line';
  from: Pt;
  to: Pt;
  color: string;
  size: number;
}
export type ShapeKind = 'rect' | 'roundRect' | 'ellipse';
export interface ShapeObject extends BaseObject {
  type: 'shape';
  shape: ShapeKind;
  rect: Rect;
  color: string;
  size: number;
}
export interface PenObject extends BaseObject {
  type: 'pen';
  points: Pt[];
  color: string;
  size: number;
}
export interface HighlightObject extends BaseObject {
  type: 'highlight';
  points: Pt[];
  color: string;
  size: number;
}
export interface TextObject extends BaseObject {
  type: 'text';
  pos: Pt;
  text: string;
  color: string;
  fontSize: number;
  maxWidth?: number;
}
export type StampGlyph = 'check' | 'x' | 'question' | 'exclaim' | 'heart';
export interface StampObject extends BaseObject {
  type: 'stamp';
  glyph: StampGlyph;
  center: Pt;
  radius: number;
  color: string;
}
export interface PixelateObject extends BaseObject {
  type: 'pixelate';
  rect: Rect;
  blockSize?: number;
}

export type SkObject =
  | ImageObject
  | ArrowObject
  | LineObject
  | ShapeObject
  | PenObject
  | HighlightObject
  | TextObject
  | StampObject
  | PixelateObject;

export type ObjectType = SkObject['type'];

/** Skitch palette (§1.2). */
export const PALETTE = [
  BRAND_PINK,
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#4cd964',
  '#007aff',
  '#5856d6',
  '#ffffff',
  '#000000',
] as const;
export const DEFAULT_COLOR = BRAND_PINK;

/** Stroke size steps 1..5 → px at 1× canvas scale (§1.2). */
export const STROKE_STEPS = [2, 4, 6, 10, 16] as const;
export const strokePx = (size: number): number =>
  STROKE_STEPS[Math.max(0, Math.min(STROKE_STEPS.length - 1, Math.round(size) - 1))];

export const haloPx = (strokeWidth: number): number => Math.max(1.5, 0.35 * strokeWidth);
