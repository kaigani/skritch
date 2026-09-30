import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

export interface Command<T> {
  name: string;
  apply: (draft: Draft<T>) => void;
  /** Continuous interactions with the same key merge into one undo step until `seal()`. */
  coalesceKey?: string;
}

interface Entry {
  name: string;
  patches: Patch[];
  inversePatches: Patch[];
  coalesceKey?: string;
  sealed: boolean;
}

export const HISTORY_CAP = 200;

/**
 * Patch-based undo history (§4.2). Pure: holds the current state and returns new states; the
 * zustand store is a thin wrapper around it.
 */
export class History<T> {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  constructor(public state: T) {}

  execute(cmd: Command<T>): T {
    const [next, patches, inversePatches] = produceWithPatches(this.state, cmd.apply);
    if (patches.length === 0) return this.state;
    this.state = next as T;
    this.redoStack = [];
    const last = this.undoStack[this.undoStack.length - 1];
    if (cmd.coalesceKey && last && !last.sealed && last.coalesceKey === cmd.coalesceKey) {
      last.patches = last.patches.concat(patches);
      last.inversePatches = inversePatches.concat(last.inversePatches);
    } else {
      if (last) last.sealed = true;
      this.undoStack.push({
        name: cmd.name,
        patches,
        inversePatches,
        coalesceKey: cmd.coalesceKey,
        sealed: !cmd.coalesceKey,
      });
      if (this.undoStack.length > HISTORY_CAP) this.undoStack.shift();
    }
    return this.state;
  }

  /** Ends the current coalescing run (pointer-up / blur). */
  seal(): void {
    const last = this.undoStack[this.undoStack.length - 1];
    if (last) last.sealed = true;
  }

  undo(): T {
    const e = this.undoStack.pop();
    if (!e) return this.state;
    e.sealed = true;
    this.state = applyPatches(this.state as any, e.inversePatches) as T;
    this.redoStack.push(e);
    return this.state;
  }

  redo(): T {
    const e = this.redoStack.pop();
    if (!e) return this.state;
    this.state = applyPatches(this.state as any, e.patches) as T;
    this.undoStack.push(e);
    return this.state;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoName(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.name;
  }
  get depth(): number {
    return this.undoStack.length;
  }

  /** Replaces the state and clears history (open / new document). */
  reset(state: T): void {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
  }
}
