import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { srgbToLinear } from './color';
import { evalCurve, isSrgbProfile, manageSource, parseIcc, profileImage, profileToXyz, XYZ_D50_TO_LINEAR_SRGB, type IccProfile } from './icc';

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

describe('manageSource', () => {
  const eight = (data: number[], icc?: Uint8Array) => ({ data: Uint8Array.from(data), width: data.length / 4, height: 1, bitDepth: 8 as const, ...(icc ? { icc } : {}) });

  it('keeps 8-bit images without a profile, or with an sRGB one, as 8-bit pixels: the plain sRGB path', () => {
    for (const icc of [undefined, load('sRGB.icc')]) {
      const m = manageSource(eight([10, 20, 30, 255, 40, 50, 60, 128], icc));
      expect(m.wide).toBe(false);
      expect(m.warning).toBeUndefined();
      expect('data' in m.image && m.image.data instanceof Uint8ClampedArray).toBe(true);
      expect(Array.from(m.image.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 128]);
    }
  });

  it('converts a wide-gamut profile to extended linear sRGB and says the source was wide', () => {
    const m = manageSource(eight([255, 0, 0, 255], load('display-p3-v4.icc')));
    expect(m.wide).toBe(true);
    expect(m.image.data).toBeInstanceOf(Float32Array);
    expect(m.image.data[1]).toBeLessThan(0);
    expect(m.image.data[0]).toBeGreaterThan(1);
  });

  it('turns 16-bit samples without a profile into linear light through the sRGB curve; float samples are linear already', () => {
    const m = manageSource({ data: Uint16Array.of(65535, 0, 32896, 65535), width: 1, height: 1, bitDepth: 16 });
    expect(m.wide).toBe(false);
    expect(Array.from(m.image.data)).toEqual([1, 0, Math.fround(srgbToLinear(32896 / 65535)), 1]);
    // Float images (TIFF, EXR, Radiance) hold linear light: the values are used as they are, premultiplied, HDR and negatives kept.
    const f = manageSource({ data: Float32Array.of(0.5, 2, -0.1, 0.5), width: 1, height: 1, bitDepth: 32 });
    expect(Array.from(f.image.data)).toEqual([0.25, 1, Math.fround(-0.1 * 0.5), 0.5]);
    expect(f.converted).toBe(false);
  });

  it('converts linear HDR pixels from the primaries the file names into sRGB, and says it was wide', () => {
    const rec2020 = { red: [0.708, 0.292], green: [0.17, 0.797], blue: [0.131, 0.046], white: [0.3127, 0.329] } as const;
    const px = (rgb: number[]) => manageSource({ data: Float32Array.of(...rgb, 1), width: 1, height: 1, bitDepth: 32, linear: true, primaries: rec2020 });
    const red = px([1, 0, 0]);
    // littleCMS's value for Rec. 2020 red in linear sRGB (reference.json, rec2020-table-v2.icc).
    [1.66053307, -0.12458041, -0.018145].forEach((v, i) => expect(red.image.data[i]).toBeCloseTo(v, 3));
    expect(red.wide).toBe(true);
    expect(red.converted).toBe(true);
    // The white point is the same, so white stays white at any level, HDR included.
    [8, 8, 8].forEach((v, i) => expect(px([8, 8, 8]).image.data[i]).toBeCloseTo(v, 4));
    // sRGB's own primaries are left alone, bit for bit.
    const srgb = manageSource({ data: Float32Array.of(0.3, 4, 0.1, 1), width: 1, height: 1, bitDepth: 32, linear: true, primaries: { red: [0.64, 0.33], green: [0.3, 0.6], blue: [0.15, 0.06], white: [0.3127, 0.329] } });
    expect(Array.from(srgb.image.data)).toEqual(Array.from(Float32Array.of(0.3, 4, 0.1, 1)));
    expect(srgb.wide).toBe(false);
  });

  it('applies a wide profile to float samples as well', () => {
    const m = manageSource({ data: Float32Array.of(1, 0, 0, 1), width: 1, height: 1, bitDepth: 32, icc: load('display-p3-v4.icc') });
    const ref = manageSource(eight([255, 0, 0, 255], load('display-p3-v4.icc')));
    for (let k = 0; k < 4; k++) expect(m.image.data[k]).toBeCloseTo(ref.image.data[k]!, 6);
  });

  it('treats a profile it cannot use as sRGB and says so, never fails', () => {
    const m = manageSource(eight([1, 2, 3, 255], load('ITULab.icc')));
    expect(m.warning).toMatch(/ITULab|Lab|unsupported/i);
    expect(m.wide).toBe(false);
    expect(Array.from(m.image.data)).toEqual([1, 2, 3, 255]);
    expect(manageSource(eight([1, 2, 3, 255], new Uint8Array(40))).warning).toMatch(/short|unsupported/i);
  });

  it('a grey profile is not wide', () => {
    expect(manageSource({ data: Uint8Array.of(128, 128, 128, 255), width: 1, height: 1, bitDepth: 8, icc: load('Gray.icc') }).wide).toBe(false);
  });
});

describe('profileImage on floats outside [0, 1]', () => {
  it('continues the curve linearly past 1 and mirrors it below 0, monotonically', () => {
    const p = parseIcc(load('display-p3-v4.icc'));
    const at = (v: number) => profileImage({ data: Float32Array.of(v, v, v, 1), width: 1, height: 1, bitDepth: 32 }, p).data[0]!;
    expect(at(1)).toBeCloseTo(1, 4);
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(4)).toBeGreaterThan(at(2));
    expect(at(-0.5)).toBeCloseTo(-at(0.5), 6);
    expect(at(1.001) - at(1)).toBeGreaterThan(0);
  });
});
