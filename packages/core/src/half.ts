// IEEE 754 binary16 <-> binary32, round-to-nearest-even.
// Needed because rgba16float textures are uploaded and read back as raw halves,
// and Float16Array is not available everywhere yet.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function float32ToFloat16(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;

  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf / NaN
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // overflow

  if (e <= 0) {
    // Subnormal half (or zero).
    const shift = 14 - e;
    if (shift > 24) return sign;
    const full = mant | 0x800000;
    let m = full >>> shift;
    const rem = full & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && m & 1)) m++;
    return sign | m;
  }

  let h = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++; // a carry may round up to Inf, which is correct
  return sign | h;
}

export function float16ToFloat32(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

export function toFloat16Array(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = float32ToFloat16(src[i]!);
  return out;
}

export function fromFloat16Array(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = float16ToFloat32(src[i]!);
  return out;
}
