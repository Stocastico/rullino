// Histogram equalisation of OKLab lightness, global or per tile (CLAHE), shared by `equalize` and
// `clahe`. The CDF is interpolated linearly inside each bin, so the mapping is continuous: a pixel
// whose lightness falls in a neighbouring bin on the GPU (f32 vs f64) moves the result by one
// count in a histogram, not by a whole step.

import { createImage, linearToOklab, oklabToLinear, type LinearImage, type PassDef } from '@rullino/core';

export const BINS = 256;

/** Tiles actually used: at most one per pixel in each direction, so no tile is empty. */
export const effectiveTiles = (tiles: number, w: number, h: number) => Math.max(1, Math.min(tiles, w, h));

/** CDF of a histogram after clipping at `clip` × the mean bin and spreading the excess evenly. */
function clippedCdf(hist: ArrayLike<number>, clip: number): Float64Array {
  const cdf = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < BINS; i++) total += hist[i]!;
  if (total === 0) {
    for (let i = 0; i < BINS; i++) cdf[i] = (i + 1) / BINS; // identity mapping
    return cdf;
  }
  const limit = (clip * total) / BINS;
  let excess = 0;
  for (let i = 0; i < BINS; i++) excess += Math.max(hist[i]! - limit, 0);
  let acc = 0;
  for (let i = 0; i < BINS; i++) {
    acc += Math.min(hist[i]!, limit) + excess / BINS;
    cdf[i] = acc / total;
  }
  return cdf;
}

/** The CDF at lightness v, linear inside each bin (0 at the bottom edge of bin 0). */
function cdfAt(cdf: Float64Array, offset: number, v: number): number {
  const p = Math.min(1, Math.max(0, v)) * BINS;
  const b = Math.min(Math.floor(p), BINS - 1);
  const lo = b === 0 ? 0 : cdf[offset + b - 1]!;
  return lo + (cdf[offset + b]! - lo) * (p - b);
}

/** Lower tile index and blend weight of a pixel along one axis (tile centres, clamped). */
function tileBlend(x: number, size: number, tiles: number): [number, number, number] {
  const g = Math.min(tiles - 1, Math.max(0, ((x + 0.5) * tiles) / size - 0.5));
  const t0 = Math.floor(g);
  return [t0, Math.min(t0 + 1, tiles - 1), g - t0];
}

export function equalizeCpu(src: LinearImage, tilesParam: number, clip: number, amount: number): LinearImage {
  const { width: w, height: h } = src;
  const tiles = effectiveTiles(tilesParam, w, h);
  const labs = new Float64Array(w * h * 3);
  const hist = new Float64Array(tiles * tiles * BINS);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = src.data[i * 4 + 3]!;
      if (a <= 0) continue;
      const lab = linearToOklab(src.data[i * 4]! / a, src.data[i * 4 + 1]! / a, src.data[i * 4 + 2]! / a);
      labs.set(lab, i * 3);
      const tile = Math.min(Math.floor((y * tiles) / h), tiles - 1) * tiles + Math.min(Math.floor((x * tiles) / w), tiles - 1);
      hist[tile * BINS + Math.min(BINS - 1, Math.floor(Math.min(1, Math.max(0, lab[0])) * BINS))]!++;
    }
  const cdfs = new Float64Array(tiles * tiles * BINS);
  for (let t = 0; t < tiles * tiles; t++) cdfs.set(clippedCdf(hist.subarray(t * BINS, (t + 1) * BINS), clip), t * BINS);

  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    const [y0, y1, fy] = tileBlend(y, h, tiles);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = src.data[i * 4 + 3]!;
      if (a <= 0) continue;
      const [x0, x1, fx] = tileBlend(x, w, tiles);
      const L = labs[i * 3]!;
      const m = (ty: number, tx: number) => cdfAt(cdfs, (ty * tiles + tx) * BINS, L);
      const top = m(y0, x0) + (m(y0, x1) - m(y0, x0)) * fx;
      const bottom = m(y1, x0) + (m(y1, x1) - m(y1, x0)) * fx;
      const mapped = top + (bottom - top) * fy;
      const rgb = oklabToLinear(L + (mapped - L) * amount, labs[i * 3 + 1]!, labs[i * 3 + 2]!);
      out.data.set([rgb[0] * a, rgb[1] * a, rgb[2] * a, a], i * 4);
    }
  }
  return out;
}

/** Buffer sizes for at most `maxTiles` per axis. */
export const equalizeBuffers = (maxTiles: number) => ({ hist: maxTiles * maxTiles * BINS, cdf: maxTiles * maxTiles * BINS });

/**
 * The three passes: per-tile histograms (atomics), one invocation per tile building its clipped
 * CDF (stored as f32 bits), and the mapping. `tiles` / `clip` are WGSL expressions (params or
 * constants; params via the global `params`, as helper functions have no `p`), so both filters share the code.
 */
export function equalizePasses(tiles: string, clip: string): PassDef[] {
  const common = /* wgsl */ `
fn eq_tiles() -> i32 {
  let s = size();
  return max(1, min(i32(${tiles}), min(s.x, s.y)));
}

fn eq_tile(xy: vec2i) -> i32 {
  let t = eq_tiles();
  let s = size();
  return min(xy.y * t / s.y, t - 1) * t + min(xy.x * t / s.x, t - 1);
}`;
  return [
    {
      kind: 'compute',
      name: 'histogram',
      inputs: ['input'],
      buffers: ['hist'],
      dispatch: 'pixels',
      wgsl: /* wgsl */ `${common}
fn run(xy: vec2i, p: Params) {
  let c = load_input(xy);
  if (c.a <= 0.0) { return; }
  let L = rl_linear_to_oklab(c.rgb / c.a).x;
  let bin = min(${BINS - 1}u, u32(floor(clamp(L, 0.0, 1.0) * ${BINS}.0)));
  atomicAdd(&buf_hist[u32(eq_tile(xy)) * ${BINS}u + bin], 1u);
}`,
    },
    {
      // One invocation per tile, reusing the pixel dispatch (the image has at least as many
      // pixels as tiles per axis).
      kind: 'compute',
      name: 'cdf',
      inputs: ['input'],
      buffers: ['hist', 'cdf'],
      dispatch: 'pixels',
      wgsl: /* wgsl */ `${common}
fn run(xy: vec2i, p: Params) {
  let t = eq_tiles();
  if (xy.x >= t || xy.y >= t) { return; }
  let base = u32(xy.y * t + xy.x) * ${BINS}u;
  var total = 0.0;
  for (var i = 0u; i < ${BINS}u; i++) { total += f32(atomicLoad(&buf_hist[base + i])); }
  if (total == 0.0) {
    for (var i = 0u; i < ${BINS}u; i++) { atomicStore(&buf_cdf[base + i], bitcast<u32>(f32(i + 1u) / ${BINS}.0)); }
    return;
  }
  let limit = f32(${clip}) * total / ${BINS}.0;
  var excess = 0.0;
  for (var i = 0u; i < ${BINS}u; i++) { excess += max(f32(atomicLoad(&buf_hist[base + i])) - limit, 0.0); }
  var acc = 0.0;
  for (var i = 0u; i < ${BINS}u; i++) {
    acc += min(f32(atomicLoad(&buf_hist[base + i])), limit) + excess / ${BINS}.0;
    atomicStore(&buf_cdf[base + i], bitcast<u32>(acc / total));
  }
}`,
    },
    {
      name: 'out',
      inputs: ['input'],
      buffers: ['cdf'],
      wgsl: /* wgsl */ `${common}
fn eq_cdf_at(tile: i32, v: f32) -> f32 {
  let p = clamp(v, 0.0, 1.0) * ${BINS}.0;
  let b = min(u32(floor(p)), ${BINS - 1}u);
  let base = u32(tile) * ${BINS}u;
  var lo = 0.0;
  if (b > 0u) { lo = bitcast<f32>(atomicLoad(&buf_cdf[base + b - 1u])); }
  let hi = bitcast<f32>(atomicLoad(&buf_cdf[base + b]));
  return lo + (hi - lo) * (p - f32(b));
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  if (c.a <= 0.0) { return vec4f(0.0); }
  let lab = rl_linear_to_oklab(c.rgb / c.a);
  let t = eq_tiles();
  let g = clamp((vec2f(xy) + 0.5) * f32(t) / vec2f(size()) - 0.5, vec2f(0.0), vec2f(f32(t - 1)));
  let t0 = vec2i(floor(g));
  let t1 = min(t0 + 1, vec2i(t - 1));
  let f = g - floor(g);
  let m00 = eq_cdf_at(t0.y * t + t0.x, lab.x);
  let m01 = eq_cdf_at(t0.y * t + t1.x, lab.x);
  let m10 = eq_cdf_at(t1.y * t + t0.x, lab.x);
  let m11 = eq_cdf_at(t1.y * t + t1.x, lab.x);
  let top = m00 + (m01 - m00) * f.x;
  let bottom = m10 + (m11 - m10) * f.x;
  let mapped = top + (bottom - top) * f.y;
  let rgb = rl_oklab_to_linear(vec3f(lab.x + (mapped - lab.x) * p.amount, lab.yz));
  return vec4f(rgb * c.a, c.a);
}`,
    },
  ];
}
