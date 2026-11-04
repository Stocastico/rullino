import { createImage, defaultParams, runChainCpu, type ParamSchema } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { filters } from './index';
import { parityCases, parityImages } from './test-utils';

describe('filter registry', () => {
  it('has unique ids', () => {
    const ids = filters.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the expected filters', () => {
    expect(filters.map((f) => f.id).sort()).toEqual(
      ['adaptiveThreshold', 'applyLut', 'ascii', 'bilateral', 'blackPoint', 'bloom', 'boxBlur', 'brightness', 'canny', 'channelMixer', 'chromaticAberration', 'clahe', 'colorGrading', 'colorMixer', 'contrast', 'convolve', 'curves', 'dither', 'emboss', 'equalize', 'exposure', 'gamma', 'gaussianBlur', 'gradient', 'gradientMap', 'grain', 'grayscale', 'halftone', 'hue', 'inpaint', 'invert', 'kuwahara', 'laplacian', 'lensBlur', 'levels', 'median', 'morphology', 'otsu', 'patch', 'pixelate', 'posterize', 'saturation', 'shadowsHighlights', 'sharpen', 'sketch', 'threshold', 'transparency', 'unsharpMask', 'vibrance', 'vignette', 'whiteBalance'].sort(),
    );
  });

  it.each(filters.map((f) => [f.id, f] as const))('%s: defaults are valid and every param has a label', (_, f) => {
    const mask = f.kind === 'multipass' && f.usesMask ? new Float32Array([1]) : undefined;
    expect(() => f.cpu({ width: 1, height: 1, data: new Float32Array([0.2, 0.3, 0.4, 1]) }, defaultParams(f.params), mask)).not.toThrow();
    for (const p of Object.values(f.params as ParamSchema)) expect(p.label, `${f.id} param label`).toBeTruthy();
  });

  // The playground and the generated reference explain filters from their schemas.
  it.each(filters.map((f) => [f.id, f] as const))(
    '%s: has a description, a try-this and a description on every param',
    (_, f) => {
      expect(f.description, `${f.id} description`).toBeTruthy();
      expect(f.tryThis, `${f.id} tryThis`).toBeTruthy();
      for (const [key, p] of Object.entries(f.params as ParamSchema)) expect(p.description, `${f.id}.${key} description`).toBeTruthy();
    },
  );

  // The effect browser shows every filter on a thumbnail, so what it draws must differ from the
  // original. Filters that do nothing at their defaults declare `preview` values. Needs masks or
  // images, or a LUT file, cannot be shown this way.
  const NO_THUMBNAIL = new Set(['applyLut', 'inpaint', 'patch', 'lensBlur']);
  it.each(filters.filter((f) => !NO_THUMBNAIL.has(f.id)).map((f) => [f.id, f] as const))('%s: its thumbnail differs from the original', (_, f) => {
    const img = createImage(24, 24);
    // A ramp plus a little deterministic noise: a median of a pure ramp would be the identity.
    for (let i = 0; i < 24 * 24; i++) img.data.set([((i % 24) / 24) * 0.8, (Math.floor(i / 24) / 24) * 0.7, 0.3 + 0.2 * (((i * 2654435761) >>> 8) % 100) / 100, 1], i * 4);
    const out = runChainCpu([{ filter: f, params: { ...defaultParams(f.params), ...f.preview }, enabled: true } as never], img);
    let diff = 0;
    for (let i = 0; i < out.data.length; i++) diff = Math.max(diff, Math.abs(out.data[i]! - img.data[i]!));
    expect(diff, `${f.id} looks the same as the original with its preview values`).toBeGreaterThan(1e-3);
  });

  // Pointwise and `perPixel` filters may be baked into a LUT (bakeLut, the playground's .cube export):
  // their output pixel must depend on that input pixel's colour alone, so shuffling the pixels of the
  // image (new positions, new neighbours) must shuffle the output the same way and change nothing
  // else. A cyclic shift, not a reversal: reversing is a 180° turn, which a vignette survives.
  const perPixel = filters.filter((f) => f.kind === 'pointwise' || f.perPixel);
  it('marks exactly applyLut as a per-pixel multipass filter', () => {
    expect(perPixel.filter((f) => f.kind === 'multipass').map((f) => f.id)).toEqual(['applyLut']);
  });
  it.each(perPixel.map((f) => [f.id, f] as const))('%s: per pixel, so independent of position and neighbours', (_, f) => {
    const src = parityImages.noise;
    const shuffled = (img: typeof src) => {
      const out = createImage(img.width, img.height);
      const n = img.width * img.height;
      for (let i = 0; i < n; i++) out.data.set(img.data.subarray(i * 4, i * 4 + 4), ((i + 101) % n) * 4);
      return out;
    };
    for (const [name, params] of parityCases(f.params as ParamSchema)) {
      const a = shuffled(runChainCpu([{ filter: f, params }], src));
      const b = runChainCpu([{ filter: f, params }], shuffled(src));
      expect(Array.from(b.data), `${f.id} ${name}`).toEqual(Array.from(a.data));
    }
  });
});
