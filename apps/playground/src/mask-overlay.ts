import { paintStroke, type BrushOptions, type LinearMask, type Mask, type RadialMask, type RasterMask, type Vec2 } from '@rullino/core';

// On-image handles for gradient masks, drawn in an SVG laid over the canvases. The SVG uses the
// display image's pixel coordinates (viewBox = image size), so ellipses and the gradient's
// perpendicular lines look the way the mask is computed (distances in units of the longer side).

const NS = 'http://www.w3.org/2000/svg';

export interface MaskOverlay {
  /** Shows handles for `mask` (none for undefined or non-gradient masks) on a w x h image. */
  show(mask: Mask | undefined, w: number, h: number): void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const set = (node: SVGElement, attrs: Record<string, number | string>) => {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * `onChange` receives every edited mask while dragging; `onDragStart` lets the caller switch to
 * preview rendering (the drag ends with the window's pointerup).
 */
export interface OverlayTools {
  readonly tool: () => 'paint' | 'erase' | 'wand';
  readonly brush: () => BrushOptions;
  /** Wand click: the mask with the region at `uv` added (or removed, with `subtract`). */
  readonly wand: (mask: RasterMask, uv: Vec2, subtract: boolean) => Promise<Mask | undefined>;
  /** The mask with its raster at the current image's resolution (called when a stroke starts). */
  readonly fit: (mask: RasterMask) => RasterMask;
}

export function createMaskOverlay(svg: SVGSVGElement, onChange: (mask: Mask) => void, onDragStart: () => void, tools: OverlayTools): MaskOverlay {
  let mask: Mask | undefined;
  let size: Vec2 = [1, 1];
  // Elements are rebuilt only when the mask kind changes: replacing a handle while it is being
  // dragged would drop its pointer capture.
  let builtFor: string | undefined;
  let update = () => {};

  const handle = (name: string, drag: (u: number, v: number) => Mask | undefined) => {
    const c = el('circle', { class: 'mask-handle' });
    c.dataset.handle = name;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      onDragStart();
      const move = (ev: PointerEvent) => {
        const r = svg.getBoundingClientRect();
        const next = drag(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
        if (!next) return;
        mask = next;
        update();
        onChange(next);
      };
      const stop = () => {
        c.removeEventListener('pointermove', move);
        c.removeEventListener('pointerup', stop);
        c.removeEventListener('pointercancel', stop);
      };
      c.addEventListener('pointermove', move);
      c.addEventListener('pointerup', stop);
      c.addEventListener('pointercancel', stop);
    });
    return c;
  };

  function buildLinear() {
    const guide = el('line', { class: 'mask-guide' });
    const edges = [el('line', { class: 'mask-edge' }), el('line', { class: 'mask-edge' })];
    const ends = (['from', 'to'] as const).map((key) =>
      handle(key, (u, v) => {
        const m = mask as LinearMask;
        const other = key === 'from' ? m.to : m.from;
        return u === other[0] && v === other[1] ? undefined : { ...m, [key]: [u, v] };
      }),
    );
    svg.append(guide, ...edges, ...ends);
    update = () => {
      const m = mask as LinearMask;
      const [w, h] = size;
      const f = [m.from[0] * w, m.from[1] * h];
      const t = [m.to[0] * w, m.to[1] * h];
      set(guide, { x1: f[0]!, y1: f[1]!, x2: t[0]!, y2: t[1]! });
      // Lines of constant mask value through both ends, perpendicular to the gradient.
      const len = Math.hypot(t[0]! - f[0]!, t[1]! - f[1]!);
      const reach = Math.hypot(w, h);
      const [px, py] = [(-(t[1]! - f[1]!) / len) * reach, ((t[0]! - f[0]!) / len) * reach];
      [f, t].forEach((p, i) => set(edges[i]!, { x1: p[0]! - px, y1: p[1]! - py, x2: p[0]! + px, y2: p[1]! + py }));
      [f, t].forEach((p, i) => set(ends[i]!, { cx: p[0]!, cy: p[1]! }));
    };
  }

  function buildRadial() {
    const outer = el('ellipse', { class: 'mask-edge' });
    const inner = el('ellipse', { class: 'mask-edge mask-inner' });
    const centre = handle('center', (u, v) => ({ ...(mask as RadialMask), center: [u, v] }));
    const side = () => Math.max(...size);
    const rx = handle('rx', (u) => {
      const m = mask as RadialMask;
      return { ...m, radius: [Math.max(0.01, Math.abs(u - m.center[0]) * size[0] / side()), m.radius[1]] };
    });
    const ry = handle('ry', (_, v) => {
      const m = mask as RadialMask;
      return { ...m, radius: [m.radius[0], Math.max(0.01, Math.abs(v - m.center[1]) * size[1] / side())] };
    });
    svg.append(outer, inner, centre, rx, ry);
    update = () => {
      const m = mask as RadialMask;
      const [cx, cy] = [m.center[0] * size[0], m.center[1] * size[1]];
      const [ax, ay] = [m.radius[0] * side(), m.radius[1] * side()];
      set(outer, { cx, cy, rx: ax, ry: ay });
      set(inner, { cx, cy, rx: ax * (1 - m.feather), ry: ay * (1 - m.feather) });
      set(centre, { cx, cy });
      set(rx, { cx: cx + ax, cy });
      set(ry, { cx, cy: cy + ay });
    };
  }

  // Brush: the whole overlay takes pointer input; each move paints the segment since the last one.
  function buildBrush() {
    svg.classList.add('painting');
    const cursor = el('circle', { class: 'brush-cursor' });
    svg.append(cursor);
    const toUv = (e: PointerEvent): Vec2 => {
      const r = svg.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    let last: Vec2 | undefined;
    const paint = (to: Vec2) => {
      const m = mask as RasterMask;
      mask = { ...m, raster: paintStroke(m.raster, last ? [last, to] : [to], tools.brush()) };
      last = to;
      onChange(mask);
    };
    svg.onpointermove = (e) => {
      const [u, v] = toUv(e);
      const wand = tools.tool() === 'wand';
      svg.classList.toggle('wand', wand);
      set(cursor, { cx: u * size[0], cy: v * size[1], r: wand ? 0 : tools.brush().radius * Math.max(...size) });
      if (last) paint([u, v]);
    };
    svg.onpointerdown = (e) => {
      e.preventDefault();
      if (tools.tool() === 'wand') {
        void tools.wand(mask as RasterMask, toUv(e), e.altKey).then((next) => {
          if (!next) return;
          mask = next;
          onChange(next);
        });
        return;
      }
      svg.setPointerCapture(e.pointerId);
      onDragStart();
      last = undefined;
      mask = tools.fit(mask as RasterMask);
      paint(toUv(e));
    };
    svg.onpointerup = svg.onpointercancel = () => (last = undefined);
    svg.onpointerleave = () => set(cursor, { r: 0 });
  }

  return {
    show(next, w, h) {
      mask = next;
      size = [w, h];
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      // Handles keep a constant on-screen size whatever the display scale.
      svg.style.setProperty('--px', String(w / Math.max(1, svg.getBoundingClientRect().width || w)));
      const kind = next?.kind;
      if (kind !== builtFor) {
        svg.replaceChildren();
        svg.classList.remove('painting', 'wand');
        svg.onpointermove = svg.onpointerdown = svg.onpointerup = svg.onpointercancel = svg.onpointerleave = null;
        update = () => {};
        if (kind === 'linear') buildLinear();
        if (kind === 'radial') buildRadial();
        if (kind === 'raster') buildBrush();
        builtFor = kind;
      }
      update();
    },
  };
}
