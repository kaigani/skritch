import { describe, expect, it } from 'vitest';
import { History, HISTORY_CAP } from '../../src/model/commands/history';

interface S {
  n: number;
  list: number[];
}

const inc = (by = 1) => ({ name: 'inc', apply: (d: S) => void (d.n += by) });

describe('History', () => {
  it('executes, undoes and redoes', () => {
    const h = new History<S>({ n: 0, list: [] });
    h.execute(inc());
    h.execute({ name: 'push', apply: (d) => void d.list.push(7) });
    expect(h.state).toEqual({ n: 1, list: [7] });
    h.undo();
    expect(h.state).toEqual({ n: 1, list: [] });
    h.undo();
    expect(h.state).toEqual({ n: 0, list: [] });
    h.redo();
    h.redo();
    expect(h.state).toEqual({ n: 1, list: [7] });
  });

  it('coalesces by key until sealed', () => {
    const h = new History<S>({ n: 0, list: [] });
    for (let i = 0; i < 10; i++) h.execute({ ...inc(), coalesceKey: 'drag:1' });
    expect(h.depth).toBe(1);
    h.seal();
    h.execute({ ...inc(), coalesceKey: 'drag:1' });
    expect(h.depth).toBe(2);
    h.undo();
    expect(h.state.n).toBe(10);
    h.undo();
    expect(h.state.n).toBe(0);
  });

  it('ignores no-op commands and clears redo on new execute', () => {
    const h = new History<S>({ n: 0, list: [] });
    h.execute({ name: 'noop', apply: () => {} });
    expect(h.canUndo).toBe(false);
    h.execute(inc());
    h.undo();
    expect(h.canRedo).toBe(true);
    h.execute(inc(2));
    expect(h.canRedo).toBe(false);
  });

  it('caps at 200 entries', () => {
    const h = new History<S>({ n: 0, list: [] });
    for (let i = 0; i < HISTORY_CAP + 50; i++) h.execute(inc());
    expect(h.depth).toBe(HISTORY_CAP);
    while (h.canUndo) h.undo();
    expect(h.state.n).toBe(50);
  });
});
