import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { srgbToLinear } from './color';
import { evalCurve, isSrgbProfile, parseIcc, profileImage, profileToXyz, XYZ_D50_TO_LINEAR_SRGB, type IccProfile } from './icc';

// Fixtures and littleCMS's conversions of them: test/icc/make-icc-fixtures.py.
const dir = new URL('../test/icc/', import.meta.url);
const load = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));
const reference = JSON.parse(readFileSync(new URL('reference.json', dir), 'utf8')) as Record<string, { input: number[][]; xyz: number[][]; linearSrgb: number[][] }>;
const usable = Object.keys(reference);

const toLinearSrgb = (p: IccProfile, v: readonly number[]) => {
  const xyz = profileToXyz(p, v);
  const m = XYZ_D50_TO_LINEAR_SRGB;
  return [0, 1, 2].map((i) => m[i * 3]! * xyz[0]! + m[i * 3 + 1]! * xyz[1]! + m[i * 3 + 2]! * xyz[2]!);
};

describe('parseIcc', () => {
  it.each(usable)('%s: device values to XYZ (D50) as littleCMS computes them', (name) => {
    const p = parseIcc(load(name));
    expect(p.kind).not.toBe('unsupported');
    const ref = reference[name]!;
    ref.input.forEach((v, i) => {
      const got = profileToXyz(p, v);
      for (let k = 0; k < 3; k++) expect(Math.abs(got[k]! - ref.xyz[i]![k]!), `${name} ${v} [${k}]`).toBeLessThan(2e-5);
    });
  });

  it.each(usable)('%s: device values to linear sRGB, out of [0, 1] where the colour is outside sRGB', (name) => {
    const p = parseIcc(load(name));
    const ref = reference[name]!;
    ref.input.forEach((v, i) => {
      const got = toLinearSrgb(p, v);
      // littleCMS goes through a linear sRGB profile whose colorants are rounded to s15.16.
      for (let k = 0; k < 3; k++) expect(Math.abs(got[k]! - ref.linearSrgb[i]![k]!), `${name} ${v} [${k}]`).toBeLessThan(1e-4 * Math.max(1, Math.abs(ref.linearSrgb[i]![k]!)));
    });
  });

  it('reads the header and the description', () => {
    const p = parseIcc(load('display-p3-v4.icc'));
    expect(p).toMatchObject({ kind: 'matrix-trc', version: '4.3', colorSpace: 'RGB', deviceClass: 'mntr', description: 'Display P3 (test)' });
    expect(parseIcc(load('compatibleWithAdobeRGB1998.icc')).description).toMatch(/Adobe/);
    expect(parseIcc(load('Gray.icc'))).toMatchObject({ kind: 'gray', colorSpace: 'GRAY' });
  });

  it('reports what it cannot convert instead of throwing', () => {
    expect(parseIcc(load('ITULab.icc'))).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/Lab/) });
    expect(parseIcc(new Uint8Array(10))).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/short/) });
    const broken = load('display-p3-v4.icc').slice();
    broken[36] = 0; // 'acsp'
    expect(parseIcc(broken)).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/acsp/) });
    const truncated = load('display-p3-v4.icc').slice(0, 300);
    expect(parseIcc(truncated).kind).toBe('unsupported');
    // An RGB profile with no colorants (a LUT-only profile).
    const p3 = load('display-p3-v4.icc').slice();
    const n = new DataView(p3.buffer).getUint32(128);
    for (let i = 0; i < n; i++) if (String.fromCharCode(...p3.subarray(132 + 12 * i, 136 + 12 * i)) === 'rXYZ') p3.set([0x41, 0x32, 0x42, 0x30], 132 + 12 * i); // rename to A2B0
    expect(parseIcc(p3)).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/rXYZ/) });
  });

  it('never throws on mangled bytes', () => {
    const base = load('para-types34-v4.icc');
    let seed = 1;
    for (let run = 0; run < 2000; run++) {
      const b = base.slice();
      for (let k = 0; k < 4; k++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        b[seed % b.length] = seed >>> 24;
      }
      expect(() => parseIcc(b)).not.toThrow();
    }
  });
});

describe('evalCurve', () => {
  it('evaluates the curve types like the ICC specification', () => {
    expect(evalCurve({ type: 'gamma', gamma: 1 }, 0.3)).toBe(0.3);
    expect(evalCurve({ type: 'gamma', gamma: 2 }, 0.5)).toBeCloseTo(0.25, 12);
    expect(evalCurve({ type: 'table', table: new Float64Array([0, 0.5, 1]) }, 0.25)).toBeCloseTo(0.25, 12);
    expect(evalCurve({ type: 'table', table: new Float64Array([0, 0.5, 1]) }, 0.75)).toBeCloseTo(0.75, 12);
    expect(evalCurve({ type: 'table', table: new Float64Array([0.2, 0.9]) }, 1)).toBeCloseTo(0.9, 12);
    expect(evalCurve({ type: 'para', kind: 0, params: [2] }, 0.5)).toBeCloseTo(0.25, 12);
    expect(evalCurve({ type: 'para', kind: 1, params: [2, 1, -0.5] }, 0.25)).toBe(0); // below -b/a
    expect(evalCurve({ type: 'para', kind: 2, params: [1, 1, 0, 0.1] }, 0.5)).toBeCloseTo(0.6, 12);
    expect(evalCurve({ type: 'para', kind: 3, params: [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045] }, 0.5)).toBeCloseTo(srgbToLinear(0.5), 10);
    expect(evalCurve({ type: 'para', kind: 3, params: [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045] }, 0.02)).toBeCloseTo(0.02 / 12.92, 12);
    expect(evalCurve({ type: 'para', kind: 4, params: [1, 1, 0, 0.5, 0.5, 0.01, 0.2] }, 0.25)).toBeCloseTo(0.325, 12);
    expect(evalCurve({ type: 'para', kind: 4, params: [1, 1, 0, 0.5, 0.5, 0.01, 0.2] }, 0.75)).toBeCloseTo(0.76, 12);
  });
});

describe('isSrgbProfile', () => {
  it('accepts sRGB profiles and refuses the others', () => {
    expect(isSrgbProfile(parseIcc(load('sRGB.icc')))).toBe(true);
    expect(isSrgbProfile(parseIcc(new Uint8Array(readFileSync(new URL('../../codecs/test/metadata/srgb.icc', import.meta.url)))))).toBe(true);
    for (const name of ['display-p3-v4.icc', 'compatibleWithAdobeRGB1998.icc', 'rec2020-table-v2.icc', 'linear-srgb-v4.icc', 'Gray.icc', 'ITULab.icc', 'LStar-RGB.icc'])
      expect(isSrgbProfile(parseIcc(load(name))), name).toBe(false);
    // sRGB's colorants with a curve two 8-bit steps off (exponent 2.45 instead of 2.4) are not sRGB.
    const srgb = parseIcc(load('sRGB.icc'));
    const off = { type: 'para', kind: 3, params: [2.45, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045] } as const;
    expect(isSrgbProfile({ ...srgb, curves: [srgb.curves![0]!, off, srgb.curves![2]!] })).toBe(false);
    expect(isSrgbProfile({ ...srgb, curves: [srgb.curves![0]!, { ...off, params: [2.41, ...off.params.slice(1)] }, srgb.curves![2]!] })).toBe(true);
  });
});

describe('profileImage', () => {
  it('converts straight 8- and 16-bit samples to premultiplied linear sRGB', () => {
    const p = parseIcc(load('display-p3-v4.icc'));
    const eight = profileImage({ data: new Uint8Array([255, 0, 0, 255, 128, 128, 128, 102]), width: 2, height: 1, bitDepth: 8 }, p);
    const red = toLinearSrgb(p, [1, 0, 0]);
    expect(Array.from(eight.data.subarray(0, 4))).toEqual([...red.map((v) => Math.fround(v)), 1]);
    expect(red[1]).toBeLessThan(0); // P3 red is outside sRGB
    const grey = toLinearSrgb(p, [128 / 255, 128 / 255, 128 / 255]);
    expect(eight.data[4]).toBeCloseTo(grey[0]! * 0.4, 6); // premultiplied
    expect(eight.data[7]).toBeCloseTo(0.4, 6);
    const sixteen = profileImage({ data: new Uint16Array([65535, 0, 0, 65535]), width: 1, height: 1, bitDepth: 16 }, p);
    expect(Array.from(sixteen.data)).toEqual(Array.from(eight.data.subarray(0, 4)));
  });

  it('puts a grey profile on all three channels as a neutral', () => {
    const p = parseIcc(load('gray-gamma18-v2.icc'));
    const out = profileImage({ data: new Uint8Array([128, 128, 128, 255, 128, 128, 128, 51]), width: 2, height: 1, bitDepth: 8 }, p);
    const y = (128 / 255) ** (461 / 256);
    for (let k = 0; k < 3; k++) expect(out.data[k]).toBeCloseTo(y, 5);
    expect(Array.from(out.data.subarray(4)).map((v) => +v.toFixed(5))).toEqual([y * 0.2, y * 0.2, y * 0.2, 0.2].map((v) => +v.toFixed(5)));
  });

  it('refuses an unsupported profile', () => {
    expect(() => profileImage({ data: new Uint8Array(4), width: 1, height: 1, bitDepth: 8 }, parseIcc(load('ITULab.icc')))).toThrow(/unsupported/);
  });
});
