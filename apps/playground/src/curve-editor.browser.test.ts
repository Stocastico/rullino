import { describe, expect, it } from 'vitest';
import { renderCurveEditor, type CurveEditor } from './curve-editor';

type Pts = [number, number][];
const SIZE = 200;

function setup(initial: Pts = [[0, 0], [1, 1]]) {
  const root = document.createElement('div');
  root.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.append(root);
  const changes: Pts[] = [];
  const editor: CurveEditor = renderCurveEditor(root, initial, 'Tone', (v) => changes.push(v.map((p) => [...p]) as Pts));
  const svg = root.querySelector('svg')!;
  const at = (x: number, y: number) => {
    const r = svg.getBoundingClientRect();
    return { clientX: r.left + x * r.width, clientY: r.top + (1 - y) * r.height, bubbles: true, pointerId: 1 };
  };
  const points = () => root.querySelectorAll<SVGCircleElement>('circle[data-point]');
  return { root, svg, editor, changes, at, points };
}

describe('curve editor', () => {
  it('draws the curve and one handle per point', () => {
    const { root, points } = setup([[0, 0], [0.5, 0.7], [1, 1]]);
    expect(points()).toHaveLength(3);
    expect(root.querySelector('path[data-curve]')?.getAttribute('d')).toMatch(/^M/);
  });

  it('drags a point, keeping x between its neighbours and y in [0, 1]', () => {
    const { points, svg, at, changes } = setup([[0, 0], [0.5, 0.5], [1, 1]]);
    points()[1]!.dispatchEvent(new PointerEvent('pointerdown', at(0.5, 0.5)));
    svg.dispatchEvent(new PointerEvent('pointermove', at(0.3, 0.8)));
    svg.dispatchEvent(new PointerEvent('pointerup', at(0.3, 0.8)));
    const [x, y] = changes.at(-1)![1]!;
    expect(x).toBeCloseTo(0.3, 2);
    expect(y).toBeCloseTo(0.8, 2);
    // Past the right neighbour and above the top: clamped.
    points()[1]!.dispatchEvent(new PointerEvent('pointerdown', at(0.3, 0.8)));
    svg.dispatchEvent(new PointerEvent('pointermove', at(1.5, 1.4)));
    svg.dispatchEvent(new PointerEvent('pointerup', at(1.5, 1.4)));
    const [x2, y2] = changes.at(-1)![1]!;
    expect(x2).toBeLessThan(1);
    expect(y2).toBe(1);
  });

  it('adds a point where the background is clicked, in x order', () => {
    const { svg, at, changes } = setup();
    svg.dispatchEvent(new PointerEvent('pointerdown', at(0.25, 0.6)));
    svg.dispatchEvent(new PointerEvent('pointerup', at(0.25, 0.6)));
    const pts = changes.at(-1)!;
    expect(pts).toHaveLength(3);
    expect(pts[1]![0]).toBeCloseTo(0.25, 2);
    expect(pts[1]![1]).toBeCloseTo(0.6, 2);
  });

  it('removes an interior point on double-click but never goes below two points', () => {
    const { points, changes } = setup([[0, 0], [0.5, 0.7], [1, 1]]);
    points()[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(changes.at(-1)).toHaveLength(2);
    points()[0]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(points()).toHaveLength(2);
  });

  it('moves the focused point with the arrow keys', () => {
    const { points, changes } = setup([[0, 0], [0.5, 0.5], [1, 1]]);
    points()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(changes.at(-1)![1]![1]).toBeCloseTo(0.51, 6);
  });

  it('can be set from outside without emitting', () => {
    const { editor, points, changes } = setup();
    editor.set([[0, 0.2], [0.4, 0.3], [0.8, 0.9], [1, 1]]);
    expect(points()).toHaveLength(4);
    expect(changes).toHaveLength(0);
  });

  it('redraws the line through a newly added point', () => {
    const { svg, at, root } = setup();
    const before = root.querySelector('path[data-curve]')!.getAttribute('d');
    svg.dispatchEvent(new PointerEvent('pointerdown', at(0.5, 0.9)));
    svg.dispatchEvent(new PointerEvent('pointerup', at(0.5, 0.9)));
    const after = root.querySelector('path[data-curve]')!.getAttribute('d')!;
    expect(after).not.toBe(before);
    // Sample 32 of 64 is x = 0.5: drawn at y = 1 - 0.9.
    expect(after.split(' L')[32]).toMatch(/^0\.5000 0\.1000/);
  });
});

