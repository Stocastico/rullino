import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { linearToOklab, oklabToLinear } from './oklab';
import { COLOR_SPACES, decodeTransfer, encodeTransfer, fromLinearSrgb, gamutMapOklab, inGamut, outputProfile, toLinearSrgb } from './colour-space';
import { isSrgbProfile, parseIcc, profileToXyz, XYZ_D50_TO_LINEAR_SRGB } from './icc';
import { createImage } from './image';
import { exportSamples } from './encode';
import { encodeSrgb8, encodeSrgb16, linearToSrgb } from './color';

// Linear sRGB -> each space, from the primaries with colour-science 0.4.7's normalised_primary_matrix
// (D65 white on both sides, so no adaptation).
const REFERENCE: Record<string, number[]> = {
  'display-p3': [0.8224619687143625, 0.17753803128563786, 4.957898135294298e-17, 0.033194198850961615, 0.966805801149038, -8.31498395951153e-18, 0.01708263072112004, 0.0723974406639634, 0.9105199286149166],
  'adobe-rgb': [0.7151256068556247, 0.2848743931443754, -4.3521090583926173e-17, -8.356150401410994e-17, 0.9999999999999998, -3.18976402103134e-17, 2.7878296637684046e-18, 0.04116194845011838, 0.9588380515498818],
  rec2020: [0.6274038959346989, 0.3292830383778837, 0.0433130656874173, 0.0690972893582321, 0.9195403950754585, 0.011362315566309171, 0.016391438875150228, 0.08801330787722575, 0.8955952532476239],
};

describe('colour spaces', () => {
  it('lists the output spaces', () => {
    expect(COLOR_SPACES).toEqual(['srgb', 'display-p3', 'adobe-rgb', 'rec2020']);
  });

  it.each(Object.entries(REFERENCE))('linear sRGB to %s as colour-science computes it', (space, m) => {
    for (let j = 0; j < 3; j++) {
      const v = [0, 0, 0];
      v[j] = 1;
      const got = fromLinearSrgb(space as never, v);
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - m[i * 3 + j]!), `${space} [${i}][${j}]`).toBeLessThan(1e-12);
    }
  });

  it('keeps sRGB as the identity', () => {
    expect(fromLinearSrgb('srgb', [0.3, -0.2, 1.4])).toEqual([0.3, -0.2, 1.4]);
  });

  it('has each space\'s transfer function, and its inverse', () => {
    expect(encodeTransfer('srgb', 0.18)).toBeCloseTo(linearToSrgb(0.18), 14);
    expect(encodeTransfer('display-p3', 0.18)).toBeCloseTo(linearToSrgb(0.18), 14);
    expect(encodeTransfer('adobe-rgb', 0.5)).toBeCloseTo(0.5 ** (256 / 563), 14);
    // BT.2020 / BT.709 OETF: 4.5 L below β, α L^0.45 − (α − 1) above.
    expect(encodeTransfer('rec2020', 0.01)).toBeCloseTo(0.045, 14);
    expect(encodeTransfer('rec2020', 0.5)).toBeCloseTo(1.09929682680944 * 0.5 ** 0.45 - 0.09929682680944, 14);
    for (const s of COLOR_SPACES) for (const v of [0, 0.001, 0.01, 0.2, 0.7, 1]) expect(decodeTransfer(s, encodeTransfer(s, v))).toBeCloseTo(v, 12);
  });
});

/** Euclidean distance in OKLab. */
const deltaEOK = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const toLab = (space: (typeof COLOR_SPACES)[number], rgb: number[]) => {
  // back from the space's linear values to linear sRGB, then OKLab
  const inv = (v: number[]) => {
    // solve by the inverse transform: linear sRGB = M^-1 · v, computed numerically through the basis
    const cols = [0, 1, 2].map((j) => fromLinearSrgb(space, [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0]));
    const m = [cols[0]![0]!, cols[1]![0]!, cols[2]![0]!, cols[0]![1]!, cols[1]![1]!, cols[2]![1]!, cols[0]![2]!, cols[1]![2]!, cols[2]![2]!];
    const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const n = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
    return [0, 1, 2].map((r) => n[r * 3]! * v[0]! + n[r * 3 + 1]! * v[1]! + n[r * 3 + 2]! * v[2]!);
  };
  const s = inv(rgb);
  return linearToOklab(s[0]!, s[1]!, s[2]!);
};

describe('gamutMapOklab (CSS Color 4)', () => {
  // OKLab colours all around the hue circle, from dark to light, from grey to far outside any gamut.
  const samples: number[][] = [];
  for (let L = 0.05; L < 1; L += 0.15) for (let h = 0; h < 360; h += 30) for (const C of [0, 0.05, 0.15, 0.3, 0.5]) samples.push([L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]);

  it.each(COLOR_SPACES)('into %s: in gamut, within a JND of the colour at the same L and h, never more chroma', (space) => {
    let mapped = 0;
    for (const lab of samples) {
      const out = gamutMapOklab(space, lab);
      expect(inGamut(out), `${lab} -> ${out}`).toBe(true);
      const back = toLab(space, out);
      const C = Math.hypot(lab[1]!, lab[2]!);
      const C2 = Math.hypot(back[1]!, back[2]!);
      expect(C2).toBeLessThan(C + 1e-6);
      expect(Math.abs(back[0]! - lab[0]!), `L of ${lab}`).toBeLessThan(0.02 + 1e-4);
      // The hue stays (where there is chroma to have one).
      if (C2 > 0.03) {
        const dh = Math.abs(((Math.atan2(back[2]!, back[1]!) - Math.atan2(lab[2]!, lab[1]!) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(dh * C2, `h of ${lab}`).toBeLessThan(0.02 + 1e-4);
      }
      if (deltaEOK(back, lab) > 1e-6) mapped++;
    }
    expect(mapped).toBeGreaterThan(20);
  });

  it('leaves colours that are in gamut exactly as they are', () => {
    for (const space of COLOR_SPACES) {
      const rgb = [0.2, 0.5, 0.7];
      const lab = toLab(space, rgb);
      const out = gamutMapOklab(space, lab);
      for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(rgb[k]!, 6); // the test's own OKLab round trip is f64, not exact
    }
  });

  // The specification's algorithm written again in Python (test/gamut/make-gamut-reference.py).
  const reference = JSON.parse(readFileSync(new URL('../test/gamut/reference.json', import.meta.url), 'utf8')) as { lab: number[]; out: Record<string, number[]> }[];

  it.each(COLOR_SPACES)('into %s: the same colours as the specification\'s pseudocode', (space) => {
    let worst = 0;
    for (const { lab, out } of reference) {
      const got = gamutMapOklab(space, lab);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[k]! - out[space]![k]!));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('maps L >= 1 to white and L <= 0 to black', () => {
    expect(gamutMapOklab('srgb', [1.2, 0.1, 0])).toEqual([1, 1, 1]);
    expect(gamutMapOklab('srgb', [-0.1, 0.1, 0])).toEqual([0, 0, 0]);
  });

  it('is what a second pass gives back', () => {
    for (const lab of samples.slice(0, 120)) {
      const once = gamutMapOklab('srgb', lab);
      const twice = gamutMapOklab('srgb', toLab('srgb', once));
      for (let k = 0; k < 3; k++) expect(Math.abs(twice[k]! - once[k]!)).toBeLessThan(1e-6);
    }
  });

  it('keeps the hue of a saturated P3 red that sRGB cannot show, where clipping shifts it', () => {
    const lab = toLab('display-p3', [1, 0, 0]);
    const srgb = oklabToLinear(lab[0]!, lab[1]!, lab[2]!);
    expect(Math.min(...srgb)).toBeLessThan(0); // outside sRGB
    const mapped = toLab('srgb', gamutMapOklab('srgb', lab));
    const clipped = toLab('srgb', srgb.map((v) => Math.min(1, Math.max(0, v))));
    const hue = (l: number[]) => Math.atan2(l[2]!, l[1]!);
    expect(Math.abs(hue(mapped) - hue(lab))).toBeLessThan(Math.abs(hue(clipped) - hue(lab)));
  });
});

describe('exportSamples with a colour space', () => {
  const img = createImage(3, 1, new Float32Array([0.2, 0.5, 0.7, 1, 0.9, -0.25, 0.2, 1, 0.1, 0.1, 0.1, 0.5]));

  it('is the sRGB path, bit for bit, for sRGB with clipping (the default)', () => {
    expect(exportSamples(img, {})).toEqual(encodeSrgb8(img));
    expect(exportSamples(img, { colorSpace: 'srgb', gamut: 'clip' })).toEqual(encodeSrgb8(img));
    expect(exportSamples(img, { colorSpace: 'srgb', gamut: 'clip', format: 'png', bitDepth: 16 })).toEqual(encodeSrgb16(img));
  });

  it('writes the space\'s encoded values, mapping what is outside it', () => {
    const p3 = exportSamples(img, { colorSpace: 'display-p3' });
    const first = fromLinearSrgb('display-p3', [0.2, 0.5, 0.7]).map((v) => Math.round(encodeTransfer('display-p3', v) * 255));
    expect(Array.from(p3.subarray(0, 4))).toEqual([...first, 255]);
    // The second pixel is outside P3 too (negative green, red above 1): mapped, so not just clipped.
    const clipped = fromLinearSrgb('display-p3', [0.9, -0.25, 0.2]).map((v) => Math.round(encodeTransfer('display-p3', Math.min(1, Math.max(0, v))) * 255));
    expect(Array.from(p3.subarray(4, 7))).not.toEqual(clipped);
    expect(Array.from(exportSamples(img, { colorSpace: 'display-p3', gamut: 'clip' }).subarray(4, 7))).toEqual(clipped);
    // Straight alpha out, as for sRGB.
    expect(p3[11]).toBe(128);
    expect(p3[8]).toBe(Math.round(encodeTransfer('display-p3', fromLinearSrgb('display-p3', [0.2, 0.2, 0.2])[0]!) * 255));
  });

  it('maps into sRGB when asked', () => {
    const mapped = exportSamples(img, { colorSpace: 'srgb', gamut: 'map' });
    expect(Array.from(mapped.subarray(0, 4))).toEqual(Array.from(encodeSrgb8(img).subarray(0, 4)));
    expect(Array.from(mapped.subarray(4, 7))).not.toEqual(Array.from(encodeSrgb8(img).subarray(4, 7)));
  });

  it('writes 16 bits for a 16-bit PNG', () => {
    const out = exportSamples(img, { colorSpace: 'rec2020', format: 'png', bitDepth: 16 });
    expect(out).toBeInstanceOf(Uint16Array);
    const first = fromLinearSrgb('rec2020', [0.2, 0.5, 0.7]).map((v) => Math.round(encodeTransfer('rec2020', v) * 65535));
    expect(Array.from(out.subarray(0, 4))).toEqual([...first, 65535]);
  });
});

describe('outputProfile', () => {
  // The written profiles are fixtures too (test/icc/rullino-*.icc), so make-icc-fixtures.py checks
  // them against littleCMS in icc.test.ts; RULLINO_WRITE_ICC=1 rewrites them after a deliberate change.
  it.each(COLOR_SPACES)('%s: a matrix/TRC profile that reads back as the space', (space) => {
    const bytes = outputProfile(space);
    const file = new URL(`../test/icc/rullino-${space}.icc`, import.meta.url);
    if (process.env.RULLINO_WRITE_ICC) writeFileSync(file, bytes);
    expect(bytes).toEqual(new Uint8Array(readFileSync(file)));
    const p = parseIcc(bytes);
    expect(p).toMatchObject({ kind: 'matrix-trc', version: '4.3', deviceClass: 'mntr', colorSpace: 'RGB', pcs: 'XYZ', description: expect.stringContaining(({ srgb: 'sRGB', 'display-p3': 'Display P3', 'adobe-rgb': 'Adobe RGB', rec2020: 'Rec. 2020' } as const)[space]) });
    expect(isSrgbProfile(p)).toBe(space === 'srgb');
    // Encoded values through the profile land where rullino's conversion puts them (s15.16 rounding aside).
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.25, 0.75], [0.02, 0.9, 0.3]]) {
      const xyz = profileToXyz(p, v);
      const want = toLinearSrgb(space, v.map((e) => decodeTransfer(space, e)));
      const s = [0, 1, 2].map((i) => XYZ_D50_TO_LINEAR_SRGB[i * 3]! * xyz[0]! + XYZ_D50_TO_LINEAR_SRGB[i * 3 + 1]! * xyz[1]! + XYZ_D50_TO_LINEAR_SRGB[i * 3 + 2]! * xyz[2]!);
      for (let k = 0; k < 3; k++) expect(Math.abs(s[k]! - want[k]!), `${space} ${v}`).toBeLessThan(1e-4);
    }
    // The whole profile is small: it goes into every exported file.
    expect(bytes.length).toBeLessThan(600);
  });
});
