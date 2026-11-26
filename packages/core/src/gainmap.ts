// Gain maps (#182): an SDR picture plus a map of how many stops brighter the HDR picture is, per
// pixel. This is the maths (Adobe's gain map specification, as Ultra HDR and ISO 21496-1 use it);
// the JPEG container and the metadata block are in `@rullino/codecs`. Colour is in rullino's
// working space: linear, premultiplied, sRGB primaries (1 = SDR white).

import { decodeSrgb8 } from './color';
import { manageSource, type ManagedSource, type ProfiledImage } from './icc';
import { createImage, type LinearImage } from './image';

/** The gain map's parameters, per channel (R, G, B). Gains and headrooms are log2; the layout is `@rullino/codecs`' `GainMapMetadata`. */
export interface GainMapMetadata {
  readonly gainMapMin: readonly [number, number, number];
  readonly gainMapMax: readonly [number, number, number];
  readonly gamma: readonly [number, number, number];
  readonly baseOffset: readonly [number, number, number];
  readonly alternateOffset: readonly [number, number, number];
  readonly baseHdrHeadroom: number;
  readonly alternateHdrHeadroom: number;
}

/** An 8-bit gain map as decoded from its JPEG: one grey channel, or RGB(A) (the first three are R, G, B). */
export interface GainMapSamples {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 3 | 4;
}

const OFFSET = 1 / 64;
const lum = (r: number, g: number, b: number) => 0.2126 * Math.max(r, 0) + 0.7152 * Math.max(g, 0) + 0.0722 * Math.max(b, 0);

/**
 * How much of the gain a display with `displayHeadroom` (log2: 0 = SDR only, 1 = twice SDR white…)
 * should get: 0 to 1, how far it lies between the base picture's headroom and the HDR picture's.
 */
export function gainMapWeight(meta: GainMapMetadata, displayHeadroom: number): number {
  const span = meta.alternateHdrHeadroom - meta.baseHdrHeadroom;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (displayHeadroom - meta.baseHdrHeadroom) / span));
}

/**
 * The HDR picture from an SDR one (linear, premultiplied) and its gain map: per channel,
 * `H = (S + baseOffset) · 2^(G · weight) − alternateOffset` with `G` the log gain from the map
 * (bilinearly sampled at the pixel's centre, as the map is usually smaller than the picture),
 * `weight` 1 for the full HDR picture. Transparent pixels stay as they are.
 */
export function applyGainMap(sdr: LinearImage, map: GainMapSamples, meta: GainMapMetadata, weight = 1): LinearImage {
  const { width: w, height: h } = sdr;
  const out = createImage(w, h);
  const { width: mw, height: mh, channels, data } = map;
  if (data.length < mw * mh * channels) throw new RangeError(`gain map: ${data.length} samples for ${mw}×${mh}×${channels}`);
  const g = new Float64Array(3);
  const decode = (v: number, c: number) => meta.gainMapMin[c]! + (meta.gainMapMax[c]! - meta.gainMapMin[c]!) * (meta.gamma[c] === 1 ? v : v ** (1 / meta.gamma[c]!));
  for (let y = 0; y < h; y++) {
    const fy = Math.min(mh - 1, Math.max(0, ((y + 0.5) * mh) / h - 0.5));
    const y0 = Math.min(mh - 1, Math.floor(fy));
    const y1 = Math.min(mh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = sdr.data[i + 3]!;
      out.data[i + 3] = a;
      if (a <= 0) continue;
      const fx = Math.min(mw - 1, Math.max(0, ((x + 0.5) * mw) / w - 0.5));
      const x0 = Math.min(mw - 1, Math.floor(fx));
      const x1 = Math.min(mw - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const k = channels === 1 ? 0 : c;
        const at = (xx: number, yy: number) => Number(data[(yy * mw + xx) * channels + k]) / 255;
        const v = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
        g[c] = decode(v, c);
      }
      for (let c = 0; c < 3; c++) {
        const s = sdr.data[i + c]! / a;
        out.data[i + c] = ((s + meta.baseOffset[c]!) * 2 ** (g[c]! * weight) - meta.alternateOffset[c]!) * a;
      }
    }
  }
  return out;
}

/**
 * The SDR picture of an HDR one: light up to the `knee` of SDR white is left as it is, above it the
 * luminance rolls off smoothly towards 1 (never reaching it), the colour channels are scaled with it
 * and clipped to [0, 1]. Colours outside sRGB (negative channels) are clipped. The result never
 * exceeds the HDR picture, so the gain map that goes with it is 1 (zero stops) inside the SDR range.
 */
export function sdrFromHdr(hdr: LinearImage, options: { readonly knee?: number } = {}): LinearImage {
  const knee = options.knee ?? 0.8;
  const out = createImage(hdr.width, hdr.height);
  for (let i = 0; i < hdr.data.length; i += 4) {
    const a = hdr.data[i + 3]!;
    out.data[i + 3] = a;
    if (a <= 0) continue;
    const r = Math.max(hdr.data[i]! / a, 0);
    const g = Math.max(hdr.data[i + 1]! / a, 0);
    const b = Math.max(hdr.data[i + 2]! / a, 0);
    const y = lum(r, g, b);
    const scale = y > knee ? (knee + (1 - knee) * (1 - Math.exp(-(y - knee) / (1 - knee)))) / y : 1;
    out.data[i] = Math.min(1, r * scale) * a;
    out.data[i + 1] = Math.min(1, g * scale) * a;
    out.data[i + 2] = Math.min(1, b * scale) * a;
  }
  return out;
}

/**
 * The gain map that turns `sdr` into `hdr` (same size, linear, premultiplied). Per pixel the log2
 * ratio of the two (plus the offsets), scaled to 8 bits between the smallest and the largest gain,
 * averaged down to at most `maxSide` pixels on the long side (default 1024).
 *
 * With `channels: 3` (the default) the ratio is taken per colour channel, so the picture comes back
 * exactly (to the map's 8 bits) even where the SDR picture clipped a saturated highlight. With
 * `channels: 1` it is the ratio of the luminances: a quarter of the map's size and what older
 * readers expect, but a channel the SDR picture clipped stays clipped in the rebuilt HDR one.
 */
export function makeGainMap(
  sdr: LinearImage,
  hdr: LinearImage,
  options: { readonly maxSide?: number; readonly channels?: 1 | 3 } = {},
): { map: { data: Uint8Array; width: number; height: number; channels: 1 | 3 }; metadata: GainMapMetadata } {
  if (sdr.width !== hdr.width || sdr.height !== hdr.height) throw new RangeError(`the SDR and HDR pictures differ in size (${sdr.width}×${sdr.height}, ${hdr.width}×${hdr.height})`);
  const { width: w, height: h } = sdr;
  const channels = options.channels ?? 3;
  const gains = new Float64Array(w * h * channels);
  const gain = (hdrValue: number, sdrValue: number) => {
    const g = Math.log2((hdrValue + OFFSET) / (sdrValue + OFFSET));
    return sdrValue < 2 / 255 ? Math.min(g, 2.3) : g; // dark pixels must not signal large gains: a little noise there would blow up
  };
  for (let p = 0; p < w * h; p++) {
    const a = sdr.data[p * 4 + 3]!;
    if (a <= 0) continue;
    const s = [sdr.data[p * 4]! / a, sdr.data[p * 4 + 1]! / a, sdr.data[p * 4 + 2]! / a];
    const v = [hdr.data[p * 4]! / a, hdr.data[p * 4 + 1]! / a, hdr.data[p * 4 + 2]! / a];
    if (channels === 1) gains[p] = gain(lum(v[0]!, v[1]!, v[2]!), lum(s[0]!, s[1]!, s[2]!));
    else for (let c = 0; c < 3; c++) gains[p * 3 + c] = gain(Math.max(v[c]!, 0), Math.max(s[c]!, 0));
  }
  const maxSide = options.maxSide ?? 1024;
  const k = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  const mw = Math.ceil(w / k);
  const mh = Math.ceil(h / k);
  const small = new Float64Array(mw * mh * channels);
  for (let my = 0; my < mh; my++)
    for (let mx = 0; mx < mw; mx++)
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        let n = 0;
        for (let y = my * k; y < Math.min(h, (my + 1) * k); y++) for (let x = mx * k; x < Math.min(w, (mx + 1) * k); x++, n++) sum += gains[(y * w + x) * channels + c]!;
        small[(my * mw + mx) * channels + c] = sum / n;
      }
  const min = new Array<number>(channels).fill(Infinity);
  const max = new Array<number>(channels).fill(-Infinity);
  for (let i = 0; i < small.length; i++) {
    const c = i % channels;
    if (small[i]! < min[c]!) min[c] = small[i]!;
    if (small[i]! > max[c]!) max[c] = small[i]!;
  }
  for (let c = 0; c < channels; c++) if (!(min[c]! <= max[c]!)) min[c] = max[c] = 0;
  const data = new Uint8Array(mw * mh * channels);
  for (let i = 0; i < data.length; i++) {
    const c = i % channels;
    const range = max[c]! - min[c]!;
    if (range > 1e-6) data[i] = Math.round(255 * Math.min(1, Math.max(0, (small[i]! - min[c]!) / range)));
  }
  const per = (a: number[]) => [a[0]!, a[channels === 3 ? 1 : 0]!, a[channels === 3 ? 2 : 0]!] as const;
  return {
    map: { data, width: mw, height: mh, channels },
    metadata: {
      gainMapMin: per(min),
      gainMapMax: per(max),
      gamma: [1, 1, 1],
      baseOffset: [OFFSET, OFFSET, OFFSET],
      alternateOffset: [OFFSET, OFFSET, OFFSET],
      baseHdrHeadroom: 0,
      alternateHdrHeadroom: Math.max(0, ...max),
    },
  };
}

/**
 * The HDR picture of an Ultra HDR file from its two decoded JPEGs: the SDR picture (8-bit RGBA with
 * the ICC profile it carries, through `manageSource`) turned into linear light, then the gain applied
 * with `weight` (1 = the full HDR picture). `wide` and `converted` say what the SDR picture's profile
 * made of it, as in `manageSource`. The gain map is RGBA from a JPEG decoder (a grey map has R = G = B).
 */
export function reconstructHdr(
  sdr: ProfiledImage & { readonly bitDepth: 8; readonly data: Uint8Array | Uint8ClampedArray },
  gainMap: { readonly data: ArrayLike<number>; readonly width: number; readonly height: number },
  meta: GainMapMetadata,
  weight = 1,
): ManagedSource & { readonly image: LinearImage } {
  const managed = manageSource(sdr);
  const base = managed.image.data instanceof Float32Array ? (managed.image as LinearImage) : decodeSrgb8(managed.image.data as Uint8ClampedArray, managed.image.width, managed.image.height);
  return { ...managed, image: applyGainMap(base, { ...gainMap, channels: 4 }, meta, weight) };
}
