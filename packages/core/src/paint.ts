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
