/**
 * A deterministic photo-like test image, RGBA8 straight sRGB, opaque: smooth gradients (sky,
 * shadows), hard edges (a building block), fine texture (grass-like hashed noise) and saturated
 * patches, so every kind of filter has something to work on.
 */
export function testImage(width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      // Integer hash for texture: same numbers everywhere, no Math.random.
      let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const n = ((h ^ (h >>> 16)) & 255) / 255 - 0.5;
      let r: number, g: number, b: number;
      if (v < 0.45) [r, g, b] = [90 + 80 * v, 140 + 90 * v, 230 - 40 * u]; // sky
      else [r, g, b] = [60 + 50 * u + 40 * n, 110 + 40 * Math.sin(u * 9) + 50 * n, 40 + 20 * n]; // ground
      if (u > 0.55 && u < 0.8 && v > 0.25 && v < 0.75) [r, g, b] = [200 - 120 * v, 180 - 100 * v, 160 - 90 * v]; // building
      if (u > 0.1 && u < 0.18 && v > 0.6 && v < 0.7) [r, g, b] = [230, 40, 30]; // a red patch
      const i = (y * width + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
