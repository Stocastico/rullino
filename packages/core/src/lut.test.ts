import { describe, expect, it } from 'vitest';
import { applyLutCpu, createLut, identityLut, lutFromFunction, parseCube, parseHald } from './lut';

describe('3D LUTs', () => {
  it('builds identity LUTs that map every colour to itself', () => {
    for (const size of [2, 17]) {
      const lut = identityLut(size);
      for (const c of [[0, 0, 0], [1, 1, 1], [0.3, 0.7, 0.1], [0.55, 0.05, 0.99]] as const) {
        applyLutCpu(lut, c[0], c[1], c[2]).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 6));
      }
    }
  });

  it('interpolates trilinearly between entries', () => {
    // A LUT whose output is a fixed non-linear function: sampling between nodes is linear per axis.
    const lut = lutFromFunction(3, (r, g, b) => [r * r, g, 1 - b]);
    const [r, g, b] = applyLutCpu(lut, 0.25, 0.4, 0.5);
    expect(r).toBeCloseTo((0 + 0.25) / 2, 6); // between nodes 0 (0) and 0.5 (0.25)
    expect(g).toBeCloseTo(0.4, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });

  it('clamps inputs to the LUT domain', () => {
    const lut = identityLut(5);
    expect(applyLutCpu(lut, -0.5, 2, 0.5)).toEqual([0, 1, 0.5]);
  });

  it('rejects malformed data', () => {
    expect(() => createLut(1, new Float32Array(3))).toThrow(/size/);
    expect(() => createLut(4, new Float32Array(10))).toThrow(/192/);
  });
});

describe('.cube parser', () => {
  const cube = `# a comment
TITLE "Swap"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
0 1 0
1 0 0
1 1 0
0 0 1
0 1 1
1 0 1
1 1 1
`;
  it('reads size, title and data (red fastest)', () => {
    const lut = parseCube(cube);
    expect(lut.size).toBe(2);
    expect(lut.title).toBe('Swap');
    // This LUT swaps red and green.
    applyLutCpu(lut, 1, 0, 0.25).forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0.25][i]!, 6));
  });

  it('rescales a non-unit domain', () => {
    const lut = parseCube(cube.replace('DOMAIN_MAX 1 1 1', 'DOMAIN_MAX 2 2 2'));
    applyLutCpu(lut, 1, 0, 0).forEach((v, i) => expect(v).toBeCloseTo([0, 0.5, 0][i]!, 6));
  });

  it('rejects 1D LUTs, missing size and wrong counts', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(/1D/);
    expect(() => parseCube('0 0 0')).toThrow(/LUT_3D_SIZE/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/8/);
  });
});

describe('HaldCLUT', () => {
  it('reads a level-2 identity Hald image (8x8, 4^3 entries)', () => {
    const level = 2;
    const size = level * level;
    const w = level ** 3;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < size ** 3; i++) {
      const r = i % size;
      const g = Math.floor(i / size) % size;
      const b = Math.floor(i / (size * size));
      px.set([(r / (size - 1)) * 255, (g / (size - 1)) * 255, (b / (size - 1)) * 255, 255], i * 4);
    }
    const lut = parseHald(px, w, w);
    expect(lut.size).toBe(4);
    applyLutCpu(lut, 0.2, 0.6, 0.9).forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.6, 0.9][i]!, 2));
  });

  it('rejects images that are not Hald-shaped', () => {
    expect(() => parseHald(new Uint8ClampedArray(10 * 10 * 4), 10, 10)).toThrow(/Hald/);
  });
});
