import { describe, expect, it } from 'vitest';
import { makeDraggable } from './drag';
import { at, press, svgBox } from './test-utils';

describe('makeDraggable', () => {
  it('reports moves normalised to the frame until release', () => {
    const frame = svgBox(200, 100);
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    frame.append(handle);
    const moves: number[][] = [];
    let start: number[] = [];
    makeDraggable(handle, frame, (u, v) => {
      start = [u, v];
      return (u2, v2) => moves.push([u2, v2]);
    });
    const g = press(handle, ...at(frame, 0.25, 0.5));
    g.move(...at(frame, 0.5, 0.75));
    g.move(...at(frame, 1.5, -0.5)); // not clamped
    g.up();
    g.move(...at(frame, 0.1, 0.1)); // after release: ignored
    expect(start.map((x) => +x.toFixed(3))).toEqual([0.25, 0.5]);
    expect(moves.map((m) => m.map((x) => +x.toFixed(3)))).toEqual([[0.5, 0.75], [1.5, -0.5]]);
  });

  it('ignores a press when start returns nothing, and lets it propagate', () => {
    const frame = svgBox(100, 100);
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    frame.append(handle);
    let reachedFrame = false;
    frame.addEventListener('pointerdown', () => (reachedFrame = true));
    makeDraggable(handle, frame, () => undefined);
    press(handle, 10, 10);
    expect(reachedFrame).toBe(true);
  });
});
