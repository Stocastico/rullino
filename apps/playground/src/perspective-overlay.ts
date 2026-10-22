import { validateGeometry, IDENTITY_GEOMETRY, type Vec2 } from '@rullino/core';
import { makeDraggable } from './drag';

// On-image perspective editing: four handles (top-left, top-right, bottom-right, bottom-left)
// placed on the corners of something that should be rectangular; on Done that quadrilateral fills
// the frame. Shown on the oriented image without perspective, straighten or crop. Moves that
// would make the quadrilateral non-convex are refused. Elements are updated in place.

export type Quad = readonly [Vec2, Vec2, Vec2, Vec2];
const NS = 'http://www.w3.org/2000/svg';
export const UNIT_QUAD: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]];

export interface PerspectiveOverlay {
  show(quad: Quad, w: number, h: number): void;
  hide(): void;
}

const convex = (q: Quad) => {
  try {
    validateGeometry({ ...IDENTITY_GEOMETRY, perspective: q });
    return true;
  } catch {
    return false;
  }
};

export function createPerspectiveOverlay(svg: SVGSVGElement, onChange: (quad: Quad) => void): PerspectiveOverlay {
  let quad: Quad = UNIT_QUAD;
  let size: [number, number] = [1, 1];
  const outline = document.createElementNS(NS, 'polygon');
  outline.setAttribute('class', 'mask-edge');
  const handles = quad.map((_, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'mask-handle');
    c.dataset.handle = `p${i}`;
    makeDraggable(c, svg, () => (u, v) => {
      const p: Vec2 = [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
      const next = quad.map((q, j) => (j === i ? p : q)) as unknown as Quad;
      if (!convex(next)) return;
      quad = next;
      update();
      onChange(quad);
    });
    return c;
  });
  const update = () => {
    const pts = quad.map(([u, v]) => [u * size[0], v * size[1]] as const);
    outline.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    pts.forEach(([x, y], i) => {
      handles[i]!.setAttribute('cx', String(x));
      handles[i]!.setAttribute('cy', String(y));
    });
  };
  return {
    show(next, w, h) {
      quad = next;
      size = [w, h];
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.style.setProperty('--px', String(w / Math.max(1, svg.getBoundingClientRect().width || w)));
      if (!svg.contains(outline)) svg.replaceChildren(outline, ...handles);
      update();
    },
    hide() {
      svg.replaceChildren();
    },
  };
}
