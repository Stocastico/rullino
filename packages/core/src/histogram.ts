export interface Histogram {
  readonly red: Uint32Array;
  readonly green: Uint32Array;
  readonly blue: Uint32Array;
  /** Rec. 709 weights on the encoded values (what photo editors call "luminosity"). */
  readonly luma: Uint32Array;
  /** Pixels counted (fully transparent ones are skipped). */
  readonly count: number;
}

/** 256-bin histograms of straight-alpha sRGB bytes (ImageData layout), e.g. from `readSrgb8`. */
export function histogramSrgb8(bytes: Uint8ClampedArray | Uint8Array): Histogram {
  if (bytes.length % 4 !== 0) throw new RangeError(`RGBA data length must be a multiple of 4, got ${bytes.length}`);
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  const luma = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i + 3] === 0) continue;
    const r = bytes[i]!;
    const g = bytes[i + 1]!;
    const b = bytes[i + 2]!;
    red[r]!++;
    green[g]!++;
    blue[b]!++;
    luma[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]!++;
    count++;
  }
  return { red, green, blue, luma, count };
}
