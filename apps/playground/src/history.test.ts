import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes recorded states', () => {
    const h = new History('a');
    h.record('b');
    h.record('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeUndefined();
    expect(h.current).toBe('a');
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeUndefined();
  });

  it('a new record after undo drops the redo branch', () => {
    const h = new History(1);
    h.record(2);
    h.record(3);
    h.undo();
    h.record(4);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(2);
  });

  it('ignores states equal to the current one', () => {
    const h = new History({ v: 1 }, { same: (a, b) => a.v === b.v });
    h.record({ v: 1 });
    expect(h.canUndo).toBe(false);
    h.record({ v: 2 });
    expect(h.canUndo).toBe(true);
  });

  it('keeps at most `limit` undo steps', () => {
    const h = new History(0, { limit: 3 });
    for (let i = 1; i <= 10; i++) h.record(i);
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([9, 8, 7, undefined]);
  });

  it('replace() changes the current state without an undo step', () => {
    const h = new History('a');
    h.record('b');
    h.replace('B');
    expect(h.current).toBe('B');
    expect(h.undo()).toBe('a');
    expect(h.redo()).toBe('B');
  });
});
