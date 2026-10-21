import { sampleCurve } from '@rullino/core';

// Tone-curve editor: an SVG in [0, 1]² (y up). Drag handles; click empty space to add a point;
// double-click (or Delete) to remove one, keeping at least two; arrow keys nudge the focused
// point by 0.01 (Shift: 0.1). x stays strictly increasing, as the curve param requires.

type Point = [number, number];

export interface CurveEditor {
  /** Replaces the points without emitting a change. */
  set(points: readonly (readonly [number, number])[]): void;
}

const NS = 'http://www.w3.org/2000/svg';
const MIN_GAP = 0.01;
const SAMPLES = 64;

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const round = (v: number) => Math.round(v * 1000) / 1000;

export function renderCurveEditor(
  root: HTMLElement,
  initial: readonly (readonly [number, number])[],
  label: string,
  onChange: (points: readonly Point[]) => void,
): CurveEditor {
  let points: Point[] = initial.map(([x, y]) => [x, y]);
  let dragging = -1;

  const svg = svgEl('svg', { viewBox: '0 0 1 1', preserveAspectRatio: 'none', class: 'curve-editor', role: 'group' });
  svg.setAttribute('aria-label', `${label} curve`);
  const bg = svgEl('rect', { x: 0, y: 0, width: 1, height: 1, class: 'curve-bg' });
  const grid = svgEl('g', { class: 'curve-grid' });
  for (const t of [0.25, 0.5, 0.75]) {
    grid.append(svgEl('line', { x1: t, y1: 0, x2: t, y2: 1 }), svgEl('line', { x1: 0, y1: t, x2: 1, y2: t }));
  }
  grid.append(svgEl('line', { x1: 0, y1: 1, x2: 1, y2: 0, class: 'curve-diagonal' }));
  const path = svgEl('path', { class: 'curve-line', 'data-curve': '' });
  const handles = svgEl('g');
  svg.append(bg, grid, path, handles);
  root.replaceChildren(svg);

  const toUnit = (e: { clientX: number; clientY: number }): Point => {
    const r = svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  };

  /** Keeps point i strictly between its neighbours and inside [0, 1]². */
  const place = (i: number, [x, y]: Point) => {
    const lo = i === 0 ? 0 : points[i - 1]![0] + MIN_GAP;
    const hi = i === points.length - 1 ? 1 : points[i + 1]![0] - MIN_GAP;
    points[i] = [round(Math.min(hi, Math.max(lo, x))), round(Math.min(1, Math.max(0, y)))];
  };

  const emit = () => onChange(points.map(([x, y]) => [x, y]));

  function draw() {
    // sampleCurve caches its LUT per array object and `points` is edited in place: sample a copy.
    const snapshot = points.map(([x, y]) => [x, y] as const);
    const d = Array.from({ length: SAMPLES + 1 }, (_, k) => {
      const x = k / SAMPLES;
      const y = sampleCurve(snapshot, x);
      return `${k === 0 ? 'M' : 'L'}${x.toFixed(4)} ${(1 - y).toFixed(4)}`;
    }).join(' ');
    path.setAttribute('d', d);
    handles.replaceChildren(
      ...points.map(([x, y], i) => {
        const c = svgEl('circle', { cx: x, cy: 1 - y, r: 0.03, class: 'curve-point', tabindex: 0, 'data-point': i });
        c.setAttribute('aria-label', `${label} point ${i + 1}: ${x.toFixed(2)}, ${y.toFixed(2)}`);
        c.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          dragging = i;
          try {
            svg.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic or already-released pointers cannot be captured; dragging still works.
          }
        });
        c.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          remove(i);
        });
        c.addEventListener('keydown', (e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          const move: Record<string, Point> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
          if (e.key === 'Delete' || e.key === 'Backspace') return void (e.preventDefault(), remove(i));
          const d = move[e.key];
          if (!d) return;
          e.preventDefault();
          place(i, [points[i]![0] + d[0], points[i]![1] + d[1]]);
          draw();
          (handles.children[i] as SVGElement | undefined)?.focus();
          emit();
        });
        return c;
      }),
    );
  }

  function remove(i: number) {
    if (points.length <= 2) return;
    points.splice(i, 1);
    draw();
    emit();
  }

  svg.addEventListener('pointerdown', (e) => {
    // Background press: insert a point there and start dragging it.
    const [x, y] = toUnit(e);
    let i = points.findIndex((p) => p[0] > x);
    if (i === -1) i = points.length;
    const left = points[i - 1]?.[0] ?? -1;
    const right = points[i]?.[0] ?? 2;
    if (points.length >= 16 || x - left < MIN_GAP || right - x < MIN_GAP) return;
    points.splice(i, 0, [x, y]);
    place(i, [x, y]);
    dragging = i;
    draw();
    emit();
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragging < 0) return;
    place(dragging, toUnit(e));
    draw();
    emit();
  });
  const end = () => (dragging = -1);
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  draw();
  return {
    set(next) {
      points = next.map(([x, y]) => [x, y]);
      draw();
    },
  };
}
