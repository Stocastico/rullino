import { createImage, createLut, linearToSrgb, runChainCpu, srgbToLinear, type Lut, type Step } from '@rullino/core';

/**
 * Bakes a chain of pointwise steps into a 3D LUT over sRGB-encoded [0, 1]³ (the convention
 * `applyLut` uses): every grid point goes through the CPU reference chain once. A look written as
 * readable adjustments then costs a single LUT lookup per pixel. Values outside [0, 1] are clamped
 * by the LUT, so HDR highlights do not survive a baked grade.
 */
export function bakeLut(steps: readonly Step[], options: { size?: number; title?: string } = {}): Lut {
  const size = options.size ?? 33;
  for (const s of steps) {
    if (s.filter.kind !== 'pointwise') throw new Error(`bakeLut: "${s.filter.id}" is not pointwise; a LUT cannot hold a neighbourhood operation`);
  }
  const n = size ** 3;
  const grid = createImage(n, 1);
  for (let i = 0; i < n; i++) {
    const r = i % size;
    const g = Math.floor(i / size) % size;
    const b = Math.floor(i / size ** 2);
    grid.data.set([srgbToLinear(r / (size - 1)), srgbToLinear(g / (size - 1)), srgbToLinear(b / (size - 1)), 1], i * 4);
  }
  const out = runChainCpu(steps, grid).data;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = linearToSrgb(out[i * 4 + c]!);
  return createLut(size, data, options.title === undefined ? {} : { title: options.title });
}
