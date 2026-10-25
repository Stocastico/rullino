import { createRasterMask, smoothstep, type RasterMaskData, type Vec2 } from './mask';

export interface BrushOptions {
  /** In units of the raster's longer side, like mask radii. */
  readonly radius: number;
  /** Fraction of the radius that is fully opaque, in [0, 1]. Default 0.5. */
  readonly hardness?: number;
  /** Maximum value painted (or removed, when erasing), in [0, 1]. Default 1. */
  readonly strength?: number;
  readonly erase?: boolean;
}

/**
 * Paints a stroke through `points` (normalised coordinates) onto a copy of `raster`. Dabs are
 * spaced at most a quarter radius apart. Painting combines with max, so going over the same area
 * again never exceeds `strength`; erasing subtracts the dab, so erasing with the brush that
 * painted removes it completely, soft edges included.
 */
export function paintStroke(raster: RasterMaskData, points: readonly Vec2[], brush: BrushOptions): RasterMaskData {
  const { width: w, height: h } = raster;
  const out = createRasterMask(w, h, raster.data.slice());
  const r = brush.radius * Math.max(w, h);
  if (!(r > 0) || points.length === 0) return out;
  const core = r * Math.min(1, Math.max(0, brush.hardness ?? 0.5));
  const strength = brush.strength ?? 1;
  const px = points.map(([u, v]) => [u * w, v * h] as const);

  const dab = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // In f32, like the stored values, so erasing what was painted cancels exactly.
        const k = Math.fround(strength * (1 - smoothstep(core, r, Math.hypot(x + 0.5 - cx, y + 0.5 - cy))));
        if (k <= 0) continue;
        const i = y * w + x;
        out.data[i] = brush.erase ? Math.max(0, out.data[i]! - k) : Math.max(out.data[i]!, k);
      }
    }
  };

  dab(...px[0]!);
  const spacing = Math.max(0.5, r / 4);
  for (let i = 1; i < px.length; i++) {
    const [ax, ay] = px[i - 1]!;
    const [bx, by] = px[i]!;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / spacing);
    for (let s = 1; s <= n; s++) dab(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n);
  }
  return out;
}

/** A region to fill, in normalised coordinates: a rectangle or ellipse by two opposite corners of its box, or a polygon. */
export type Shape =
  | { readonly kind: 'rect'; readonly from: Vec2; readonly to: Vec2 }
  | { readonly kind: 'ellipse'; readonly from: Vec2; readonly to: Vec2 }
  | { readonly kind: 'polygon'; readonly points: readonly Vec2[] };

export interface FillOptions {
  /** Remove the shape from the mask instead of adding it. */
  readonly subtract?: boolean;
}

/** Samples per pixel side for the coverage of a shape's edge pixels. */
const COVERAGE_SAMPLES = 4;

/**
 * Fills `shape` into a copy of `raster`. Edge pixels get the fraction of the pixel the shape covers
 * (4 x 4 samples). Adding combines with max; subtracting removes the shape's coverage (`max(0, m - v)`),
 * so adding and then subtracting the same shape is a no-op, like the wand and the eraser.
 * Polygons use the even-odd rule; fewer than three points, or a flat box, fill nothing.
 */
export function fillShape(raster: RasterMaskData, shape: Shape, options: FillOptions = {}): RasterMaskData {
  const { width: w, height: h } = raster;
  const out = createRasterMask(w, h, raster.data.slice());
  const pts = shape.kind === 'polygon' ? shape.points.map(([u, v]) => [u * w, v * h] as const) : [[shape.from[0] * w, shape.from[1] * h] as const, [shape.to[0] * w, shape.to[1] * h] as const];
  if (shape.kind === 'polygon' ? pts.length < 3 : pts[0]![0] === pts[1]![0] || pts[0]![1] === pts[1]![1]) return out;

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [cx, cy, rx, ry] = [(minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX) / 2, (maxY - minY) / 2];

  const inside = (x: number, y: number): boolean => {
    if (shape.kind === 'rect') return x >= minX && x < maxX && y >= minY && y < maxY;
    if (shape.kind === 'ellipse') return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    let odd = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };

  const n = COVERAGE_SAMPLES;
  const [x0, x1] = [Math.max(0, Math.floor(minX)), Math.min(w - 1, Math.ceil(maxX))];
  const [y0, y1] = [Math.max(0, Math.floor(minY)), Math.min(h - 1, Math.ceil(maxY))];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let hits = 0;
      for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) hits += inside(x + (sx + 0.5) / n, y + (sy + 0.5) / n) ? 1 : 0;
      if (hits === 0) continue;
      const v = Math.fround(hits / (n * n));
      const i = y * w + x;
      out.data[i] = options.subtract ? Math.max(0, out.data[i]! - v) : Math.max(out.data[i]!, v);
    }
  }
  return out;
}
