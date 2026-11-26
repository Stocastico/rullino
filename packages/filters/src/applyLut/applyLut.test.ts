import { createImage, identityLut, linearToOklab, linearToSrgb, lutFromFunction, srgbToLinear } from '@rullino/core';
import { gamutMapOklab } from '@rullino/core/internal';
import { describe, expect, it } from 'vitest';
import { grey } from '../test-utils';
import { applyLut } from './index';

const invertLut = lutFromFunction(5, (r, g, b) => [1 - r, 1 - g, 1 - b]);
const run = (c: number[], p: Parameters<typeof applyLut.cpu>[1]) => [...applyLut.cpu(createImage(1, 1, new Float32Array(c)), p).data];

describe('applyLut', () => {
  it('leaves the image unchanged with an identity LUT', () => {
    const out = run([0.1, 0.4, 0.8, 1], { look: identityLut(2) });
    [0.1, 0.4, 0.8, 1].forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6));
  });

  it('looks up sRGB-encoded colour (an inverting LUT turns mid grey into mid grey)', () => {
    const out = run(grey(srgbToLinear(0.3)), { look: invertLut });
    expect(linearToSrgb(out[0]!)).toBeCloseTo(0.7, 5);
    expect(linearToSrgb(run(grey(srgbToLinear(0.5)), { look: invertLut })[0]!)).toBeCloseTo(0.5, 5);
  });

  it('blends with the original by intensity, in sRGB-encoded units', () => {
    expect(linearToSrgb(run(grey(srgbToLinear(0.3)), { look: invertLut, intensity: 0.5 })[0]!)).toBeCloseTo(0.5, 5);
    expect(run(grey(0.2), { look: invertLut, intensity: 0 })[0]).toBeCloseTo(0.2, 6);
  });

  it('works on straight colour and keeps alpha', () => {
    const out = run(grey(srgbToLinear(0.3), 0.5), { look: invertLut });
    expect(out[3]).toBe(0.5);
    expect(linearToSrgb(out[0]! / 0.5)).toBeCloseTo(0.7, 5);
    expect(run([0, 0, 0, 0], { look: invertLut })).toEqual([0, 0, 0, 0]);
  });

  it('clamps out-of-gamut input to the LUT edge, but keeps it at intensity 0', () => {
    expect(run(grey(4), { look: invertLut })[0]).toBeCloseTo(0, 6);
    expect(run(grey(4), { look: invertLut, intensity: 0 })[0]).toBeCloseTo(4, 5);
  });

  it('maps a colour outside sRGB into sRGB (OKLCh) before the lookup (#181), not channel by channel', () => {
    // A saturated Display P3 green in linear sRGB: negative red and blue.
    const wide = [-0.4, 1.05, -0.15];
    const mapped = gamutMapOklab('srgb', linearToOklab(wide[0]!, wide[1]!, wide[2]!)).map(linearToSrgb);
    const clipped = wide.map((v) => Math.min(1, Math.max(0, linearToSrgb(v))));
    expect(mapped).not.toEqual(clipped);
    // The identity LUT shows the colour that reached the lookup (intensity 1: the LUT's output).
    const out = run([...wide, 1], { look: identityLut(2) });
    mapped.forEach((v, i) => expect(linearToSrgb(out[i]!), `channel ${i}`).toBeCloseTo(v, 5));
    // Intensity 0 stays an exact no-op, negative values included.
    expect(run([...wide, 1], { look: invertLut, intensity: 0 })).toEqual(wide.concat(1).map((v) => Math.fround(v)));
  });

  it('only changes what has a negative channel: colours above 1 clamp as they always did', () => {
    const hot = run([3, 0.5, 0.2, 1], { look: identityLut(2) });
    expect([hot[0], hot[1], hot[2]].map((v) => linearToSrgb(v!))).toEqual([1, linearToSrgb(0.5), linearToSrgb(0.2)].map((v) => expect.closeTo(v, 5)));
  });

  it('does not mutate its input', () => {
    const src = createImage(1, 1, new Float32Array([0.2, 0.3, 0.4, 1]));
    applyLut.cpu(src, { look: invertLut });
    expect([...src.data]).toEqual([0.2, 0.3, 0.4, 1].map(Math.fround));
  });
});
