/**
 * A CPU-side image in the library's working space: linear-light RGB,
 * premultiplied alpha, 32-bit floats, row-major RGBA.
 */
export interface LinearImage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export function createImage(width: number, height: number, data?: Float32Array): LinearImage {
  const size = width * height * 4;
  if (data && data.length !== size) {
    throw new RangeError(`expected ${size} floats for ${width}x${height}, got ${data.length}`);
  }
  return { width, height, data: data ?? new Float32Array(size) };
}
