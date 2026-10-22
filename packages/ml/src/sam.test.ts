import { createImage, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { SAM_INPUT, samInput, samMask } from './sam';

const N = SAM_INPUT * SAM_INPUT;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

describe('samInput', () => {
  it('resizes the long side to 1024, normalises straight sRGB colour and pads with zeros (NCHW)', () => {
    // 2048 x 1024, left half sRGB 0.2 grey, right half pure red; top-right pixel half transparent.
    const img = createImage(2048, 1024);
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 2048; x++) {
        const c = x < 1024 ? [srgbToLinear(0.2), srgbToLinear(0.2), srgbToLinear(0.2)] : [1, 0, 0];
        img.data.set([...c, 1], (y * 2048 + x) * 4);
      }
    const input = samInput(img);
    expect([input.width, input.height]).toEqual([1024, 512]);
    expect(input.pixels).toHaveLength(3 * N);
    const at = (c: number, x: number, y: number) => input.pixels[c * N + y * SAM_INPUT + x]!;
    for (let c = 0; c < 3; c++) {
      expect(at(c, 100, 100)).toBeCloseTo((0.2 - MEAN[c]!) / STD[c]!, 3);
      expect(at(c, 900, 300)).toBeCloseTo(((c === 0 ? 1 : 0) - MEAN[c]!) / STD[c]!, 3);
      expect(at(c, 100, 700)).toBe(0); // padding below the image
    }
  });

  it('un-premultiplies (transparent pixels are black) and enlarges small images', () => {
    const img = createImage(2, 1, new Float32Array([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0]));
    const input = samInput(img);
    expect([input.width, input.height]).toEqual([1024, 512]);
    const at = (c: number, x: number, y: number) => input.pixels[c * N + y * SAM_INPUT + x]!;
    // Left pixel: straight linear 1 → sRGB 1; right pixel: transparent → 0.
    expect(at(0, 10, 10)).toBeCloseTo((1 - MEAN[0]!) / STD[0]!, 3);
    expect(at(0, 1000, 10)).toBeCloseTo((0 - MEAN[0]!) / STD[0]!, 3);
  });
});

describe('samMask', () => {
  it('samples the 256² logits over the image part of the 1024 frame and applies a sigmoid', () => {
    // Logits: +8 left of x = 128 (frame x = 512), −8 right of it.
    const logits = new Float32Array(256 * 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) logits[y * 256 + x] = x < 128 ? 8 : -8;
    // The image covers 1024 x 512 of the frame; the mask is wanted at 100 x 50.
    const mask = samMask(logits, { width: 1024, height: 512 }, 100, 50);
    expect(mask).toHaveLength(5000);
    expect(mask[10 * 100 + 10]).toBeCloseTo(1 / (1 + Math.exp(-8)), 5);
    expect(mask[10 * 100 + 90]).toBeCloseTo(1 / (1 + Math.exp(8)), 5);
    // The edge sits halfway across the image width.
    expect(mask[10 * 100 + 49]).toBeGreaterThan(0.5);
    expect(mask[10 * 100 + 50]).toBeLessThan(0.5);
  });

  it('only reads the image part of the frame (padding is ignored)', () => {
    // Logits positive only in the padded bottom half of the frame.
    const logits = new Float32Array(256 * 256).fill(-8);
    for (let i = 128 * 256; i < logits.length; i++) logits[i] = 8;
    const mask = samMask(logits, { width: 1024, height: 512 }, 64, 32);
    expect(Math.max(...mask.slice(0, 64 * 30))).toBeLessThan(0.01);
  });
});
