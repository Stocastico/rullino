/**
 * A CPU-side image in the library's working space: linear-light RGB,
 * premultiplied alpha, 32-bit floats, row-major RGBA.
 */
export interface LinearImage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

/** 8-bit straight-alpha sRGB pixels, row by row (ImageData layout): what image decoders produce. */
export interface Rgba8Image {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export function createImage(width: number, height: number, data?: Float32Array): LinearImage {
  const size = width * height * 4;
  if (data && data.length !== size) {
    throw new RangeError(`expected ${size} floats for ${width}x${height}, got ${data.length}`);
  }
  return { width, height, data: data ?? new Float32Array(size) };
}

/** The longest side an image param (`type: 'image'`) may have: it becomes an rgba32float texture. */
export const MAX_IMAGE_SIDE = 2048;

/**
 * Bilinear sample at normalised coordinates (u, v) in [0, 1] across the image, between pixel
 * centres, edges clamped. Returns the premultiplied RGBA values. The CPU twin of `imageSamplerWgsl`.
 */
export function sampleImage(img: LinearImage, u: number, v: number): [number, number, number, number] {
  const px = Math.min(img.width - 1, Math.max(0, u * img.width - 0.5));
  const py = Math.min(img.height - 1, Math.max(0, v * img.height - 0.5));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const [fx, fy] = [px - x0, py - y0];
  const at = (x: number, y: number, c: number) => img.data[(y * img.width + x) * 4 + c]!;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) out[c] = (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy;
  return out;
}

/**
 * WGSL for `fn <name>(uv: vec2f) -> vec4f`: {@link sampleImage} on the 2D texture variable `tex`
 * (manual bilinear with textureLoad: rgba32float is not filterable everywhere).
 */
export function imageSamplerWgsl(name: string, tex: string): string {
  return /* wgsl */ `
fn ${name}(uv: vec2f) -> vec4f {
  let dims = vec2i(textureDimensions(${tex}));
  let top = vec2f(dims) - 1.0;
  let p = clamp(uv * vec2f(dims) - 0.5, vec2f(0.0), top);
  let p0 = vec2i(floor(p));
  let f = p - floor(p);
  let p1 = min(p0 + 1, dims - 1);
  let a = textureLoad(${tex}, p0, 0);
  let b = textureLoad(${tex}, vec2i(p1.x, p0.y), 0);
  let c = textureLoad(${tex}, vec2i(p0.x, p1.y), 0);
  let d = textureLoad(${tex}, p1, 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;
}
