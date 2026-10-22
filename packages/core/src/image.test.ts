import { describe, expect, it } from 'vitest';
import { createImage, MAX_IMAGE_SIDE, sampleImage } from './image';

describe('sampleImage', () => {
  // 2 x 1: left pixel (0, 0, 0, 1), right pixel (1, 0.5, 0.25, 1).
  const img = createImage(2, 1, Float32Array.from([0, 0, 0, 1, 1, 0.5, 0.25, 1]));

  it('returns pixel values at pixel centres', () => {
    expect(sampleImage(img, 0.25, 0.5)).toEqual([0, 0, 0, 1]);
    expect(sampleImage(img, 0.75, 0.5)).toEqual([1, 0.5, 0.25, 1]);
  });

  it('interpolates bilinearly between centres and clamps beyond the edges', () => {
    expect(sampleImage(img, 0.5, 0.5)).toEqual([0.5, 0.25, 0.125, 1]);
    expect(sampleImage(img, -3, 9)).toEqual([0, 0, 0, 1]);
    expect(sampleImage(img, 4, -1)).toEqual([1, 0.5, 0.25, 1]);
  });

  it('interpolates vertically too', () => {
    const tall = createImage(1, 2, Float32Array.from([0, 0, 0, 0, 1, 1, 1, 1]));
    expect(sampleImage(tall, 0.5, 0.5)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('caps the side of an image param', () => {
    expect(MAX_IMAGE_SIDE).toBe(2048);
  });
});
