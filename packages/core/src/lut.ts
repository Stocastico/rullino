// 3D colour lookup tables. A LUT maps an RGB triple in its domain (by default [0, 1]³, meant for
// sRGB-encoded colour) to an RGB output, sampled with trilinear interpolation. The CPU sampler
// here and the WGSL one generated for 'lut' params use the same arithmetic, so results match.

export interface Lut {
  /** Entries per axis (N); data holds N³ RGB triples. */
  readonly size: number;
  /** Row-major with red fastest, then green, then blue (the .cube order). */
  readonly data: Float32Array;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
  readonly title?: string;
}

export const MAX_LUT_SIZE = 128;

export function createLut(
  size: number,
  data: Float32Array,
  options: { title?: string; domainMin?: readonly [number, number, number]; domainMax?: readonly [number, number, number] } = {},
): Lut {
  if (!Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE) throw new RangeError(`LUT size must be an integer in [2, ${MAX_LUT_SIZE}], got ${size}`);
  if (data.length !== size ** 3 * 3) throw new RangeError(`a ${size}³ LUT needs ${size ** 3 * 3} values, got ${data.length}`);
  const domainMin = options.domainMin ?? [0, 0, 0];
  const domainMax = options.domainMax ?? [1, 1, 1];
  if (!domainMin.every((v, i) => domainMax[i]! > v)) throw new RangeError('LUT domain max must exceed min on every axis');
  return { size, data, domainMin, domainMax, ...(options.title !== undefined ? { title: options.title } : {}) };
}

export function lutFromFunction(size: number, f: (r: number, g: number, b: number) => readonly [number, number, number]): Lut {
  const data = new Float32Array(size ** 3 * 3);
  const n = size - 1;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) data.set(f(r / n, g / n, b / n), ((b * size + g) * size + r) * 3);
  return createLut(size, data);
}

export const identityLut = (size = 2) => lutFromFunction(size, (r, g, b) => [r, g, b]);

/** Samples a LUT at an RGB input (domain-normalised and clamped), trilinear. Mirrors the WGSL sampler. */
export function applyLutCpu(lut: Lut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size - 1;
  const coord = [r, g, b].map((v, i) => {
    const t = (v - lut.domainMin[i]!) / (lut.domainMax[i]! - lut.domainMin[i]!);
    const p = Math.min(1, Math.max(0, t)) * n;
    const i0 = Math.min(Math.floor(p), n - 1);
    return [i0, p - i0] as const;
  });
  const [[r0, fr], [g0, fg], [b0, fb]] = coord as [readonly [number, number], readonly [number, number], readonly [number, number]];
  const at = (ri: number, gi: number, bi: number, c: number) => lut.data[((bi * lut.size + gi) * lut.size + ri) * 3 + c]!;
  const lerp = (a: number, b2: number, t: number) => a + (b2 - a) * t;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = lerp(at(r0, g0, b0, c), at(r0 + 1, g0, b0, c), fr);
    const c10 = lerp(at(r0, g0 + 1, b0, c), at(r0 + 1, g0 + 1, b0, c), fr);
    const c01 = lerp(at(r0, g0, b0 + 1, c), at(r0 + 1, g0, b0 + 1, c), fr);
    const c11 = lerp(at(r0, g0 + 1, b0 + 1, c), at(r0 + 1, g0 + 1, b0 + 1, c), fr);
    out[c] = lerp(lerp(c00, c10, fg), lerp(c01, c11, fg), fb);
  }
  return out;
}

/** Parses an Adobe/Resolve .cube file (3D LUTs only). */
export function parseCube(text: string): Lut {
  let size = 0;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  const triple = (parts: string[], line: string): [number, number, number] => {
    const v = parts.map(Number);
    if (v.length !== 3 || !v.every(Number.isFinite)) throw new SyntaxError(`.cube: bad line "${line}"`);
    return v as [number, number, number];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [head, ...rest] = line.split(/\s+/);
    switch (head) {
      case 'TITLE':
        title = line.slice(5).trim().replace(/^"|"$/g, '');
        break;
      case 'LUT_1D_SIZE':
        throw new SyntaxError('.cube: 1D LUTs are not supported, only 3D');
      case 'LUT_3D_SIZE':
        size = Number(rest[0]);
        break;
      case 'DOMAIN_MIN':
        domainMin = triple(rest, line);
        break;
      case 'DOMAIN_MAX':
        domainMax = triple(rest, line);
        break;
      default:
        if (/^[A-Z_]+$/.test(head!)) break; // other keywords (e.g. LUT_3D_INPUT_RANGE) are ignored
        values.push(...triple([head!, ...rest], line));
    }
  }
  if (!size) throw new SyntaxError('.cube: missing LUT_3D_SIZE');
  if (values.length !== size ** 3 * 3) throw new SyntaxError(`.cube: expected ${size ** 3} entries for size ${size}, got ${values.length / 3}`);
  return createLut(size, Float32Array.from(values), { ...(title !== undefined ? { title } : {}), domainMin, domainMax });
}

/** Reads a HaldCLUT image (level L: L³ x L³ pixels, L² entries per axis) from RGBA bytes. */
export function parseHald(pixels: Uint8ClampedArray, width: number, height: number): Lut {
  const level = Math.round(Math.cbrt(width));
  if (width !== height || level < 2 || level ** 3 !== width) throw new RangeError(`not a HaldCLUT: expected a square image L³ wide, got ${width}x${height}`);
  const size = level * level;
  const data = new Float32Array(size ** 3 * 3);
  for (let i = 0; i < size ** 3; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = pixels[i * 4 + c]! / 255;
  return createLut(size, data);
}
