// Tiles for rendering an image larger than a texture (or than the memory budget) on the GPU, #176:
// the 2-D twin of `planBands`. Each tile owns a rectangle and reads it with a halo of the chain's
// reach around it, clamped to the image; its texture is the rectangle plus the halo.

/** Pixels a tile owns (`x0`–`x1`, `y0`–`y1`, exclusive) and the rectangle it reads (`fromX`–`toX`, `fromY`–`toY`). */
export interface TilePlan {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

/** Splits `length` into `n` nearly equal parts: their starts and the end. */
const cuts = (length: number, side: number, halo: number): number[] => {
  if (length <= side) return [0, length]; // one tile along this axis: no neighbour, no halo needed
  const interior = side - 2 * halo;
  const n = Math.ceil(length / interior);
  return Array.from({ length: n + 1 }, (_, i) => Math.floor((i * length) / n));
};

/**
 * Cuts a `width` × `height` image into tiles whose textures are at most `side` pixels a side with a
 * halo of `halo` pixels, row by row. An image that fits is one tile; otherwise the tiles along an
 * axis are nearly equal.
 */
export function planTiles(width: number, height: number, side: number, halo: number): TilePlan[] {
  if ((width > side || height > side) && side - 2 * halo < 1) throw new RangeError(`planTiles: a halo of ${halo} px leaves no room in tiles of ${side} px`);
  const xs = cuts(width, side, halo);
  const ys = cuts(height, side, halo);
  const tiles: TilePlan[] = [];
  for (let j = 0; j + 1 < ys.length; j++)
    for (let i = 0; i + 1 < xs.length; i++) {
      const [x0, x1, y0, y1] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
      tiles.push({ x0, y0, x1, y1, fromX: Math.max(0, x0 - halo), fromY: Math.max(0, y0 - halo), toX: Math.min(width, x1 + halo), toY: Math.min(height, y1 + halo) });
    }
  return tiles;
}
