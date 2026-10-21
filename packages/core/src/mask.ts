// Masks restrict a chain step to part of the image: out = mix(in, step(in), m). Coordinates are
// normalised to the image ([0, 1] across width and height), so a mask means the same thing at
// preview, display and export resolution. Distances (gradient direction, radii) are measured in
// units of the image's longer side, so shapes are not stretched by the aspect ratio.
// The WGSL twin of maskValue() is in gpu/mask.ts; the arithmetic matches step for step.

export type Vec2 = readonly [number, number];

interface MaskOptions {
  /** Swap inside and outside. */
  readonly invert?: boolean;
  /** Multiplies the mask (after inverting), in [0, 1]. Default 1. */
  readonly opacity?: number;
}

/** 0 at `from`, 1 at `to` (smoothstep in between), constant beyond them. */
export interface LinearMask extends MaskOptions {
  readonly kind: 'linear';
  readonly from: Vec2;
  readonly to: Vec2;
}

/**
 * 1 inside an ellipse, 0 outside. `radius` is in units of the image's longer side; `feather`
 * in [0, 1] is the fraction of the radius over which it fades out (0 = hard edge).
 */
export interface RadialMask extends MaskOptions {
  readonly kind: 'radial';
  readonly center: Vec2;
  readonly radius: Vec2;
  readonly feather: number;
}

/**
 * Coverage values in [0, 1], row-major, at any resolution (bilinear, clamped to the edge). Treat
 * as immutable: GPU textures are cached per object, so create a new one for every change.
 */
export interface RasterMaskData {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface RasterMask extends MaskOptions {
  readonly kind: 'raster';
  readonly raster: RasterMaskData;
}

export type Mask = LinearMask | RadialMask | RasterMask;

export function createRasterMask(width: number, height: number, data = new Float32Array(width * height)): RasterMaskData {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError(`raster mask size must be positive integers, got ${width}x${height}`);
  if (data.length !== width * height) throw new RangeError(`a ${width}x${height} raster mask needs ${width * height} values, got ${data.length}`);
  return { width, height, data };
}

const finite = (...v: number[]) => v.every(Number.isFinite);

export function validateMask(m: Mask): void {
  const fail = (msg: string) => {
    throw new Error(`mask (${(m as { kind?: unknown }).kind}): ${msg}`);
  };
  if (m.opacity !== undefined && !(m.opacity >= 0 && m.opacity <= 1)) fail('opacity must be in [0, 1]');
  switch (m.kind) {
    case 'linear':
      if (!finite(...m.from, ...m.to)) fail('points must be finite');
      if (m.from[0] === m.to[0] && m.from[1] === m.to[1]) fail('from and to must be distinct points');
      break;
    case 'radial':
      if (!finite(...m.center, ...m.radius, m.feather)) fail('values must be finite');
      if (!(m.radius[0] > 0 && m.radius[1] > 0)) fail('radius must be > 0');
      if (!(m.feather >= 0 && m.feather <= 1)) fail('feather must be in [0, 1]');
      break;
    case 'raster': {
      const r = m.raster;
      if (!(r.data instanceof Float32Array) || r.data.length !== r.width * r.height || r.width < 1 || r.height < 1) fail('raster data must be width x height floats');
      break;
    }
    default:
      fail('unknown kind');
  }
}

/** smoothstep with a hard step when the edges coincide (feather 0). */
const smoothstep = (e0: number, e1: number, x: number) => {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function rasterAt(r: RasterMaskData, u: number, v: number) {
  const px = Math.min(r.width - 1, Math.max(0, u * r.width - 0.5));
  const py = Math.min(r.height - 1, Math.max(0, v * r.height - 0.5));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, r.width - 1);
  const y1 = Math.min(y0 + 1, r.height - 1);
  const fx = px - x0;
  const fy = py - y0;
  const at = (x: number, y: number) => r.data[y * r.width + x]!;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return top + (bottom - top) * fy;
}

/** Mask value at pixel (x, y) of a w x h image (pixel centres at x + 0.5). */
export function maskValue(m: Mask, x: number, y: number, w: number, h: number): number {
  const u = (x + 0.5) / w;
  const v = (y + 0.5) / h;
  // Normalised -> units of the longer side.
  const sx = w / Math.max(w, h);
  const sy = h / Math.max(w, h);
  let value: number;
  switch (m.kind) {
    case 'linear': {
      const ax = m.from[0] * sx;
      const ay = m.from[1] * sy;
      const dx = m.to[0] * sx - ax;
      const dy = m.to[1] * sy - ay;
      value = smoothstep(0, 1, ((u * sx - ax) * dx + (v * sy - ay) * dy) / (dx * dx + dy * dy));
      break;
    }
    case 'radial': {
      const d = Math.hypot((u - m.center[0]) * sx / m.radius[0], (v - m.center[1]) * sy / m.radius[1]);
      value = 1 - smoothstep(1 - m.feather, 1, d);
      break;
    }
    case 'raster':
      value = rasterAt(m.raster, u, v);
      break;
  }
  if (m.invert) value = 1 - value;
  return value * (m.opacity ?? 1);
}
