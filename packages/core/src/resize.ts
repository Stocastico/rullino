import { createImage, type LinearImage } from './image';

/** Largest size within `maxSide` x `maxSide` with the same aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, maxSide: number): [number, number] {
  const s = Math.min(1, maxSide / Math.max(width, height));
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
}

/** Source pixels overlapping destination pixel `d` along one axis, with their coverage weights. */
export function footprint(d: number, scale: number, size: number): [index: number, weight: number][] {
  const x0 = d * scale;
  const x1 = Math.min(size, (d + 1) * scale);
  const out: [number, number][] = [];
  for (let i = Math.floor(x0); i < Math.ceil(x1); i++) out.push([i, Math.min(x1, i + 1) - Math.max(x0, i)]);
  return out;
}

/**
 * Area-average (box) downscale: each output pixel is the exact coverage-weighted mean of the
 * source pixels under it. Done on linear premultiplied values, which is what makes it correct
 * (averaging sRGB darkens, averaging straight colour lets transparent pixels bleed in).
 */
export function downscaleCpu(src: LinearImage, width: number, height: number): LinearImage {
  if (width > src.width || height > src.height || width < 1 || height < 1) {
    throw new RangeError(`cannot downscale ${src.width}x${src.height} to ${width}x${height}`);
  }
  const sx = src.width / width;
  const sy = src.height / height;
  const out = createImage(width, height);
  for (let y = 0; y < height; y++) {
    const fy = footprint(y, sy, src.height);
    for (let x = 0; x < width; x++) {
      const fx = footprint(x, sx, src.width);
      const acc = [0, 0, 0, 0];
      for (const [j, wy] of fy) {
        for (const [i, wx] of fx) {
          const o = (j * src.width + i) * 4;
          for (let c = 0; c < 4; c++) acc[c]! += src.data[o + c]! * wx * wy;
        }
      }
      for (let c = 0; c < 4; c++) out.data[(y * width + x) * 4 + c] = acc[c]! / (sx * sy);
    }
  }
  return out;
}
