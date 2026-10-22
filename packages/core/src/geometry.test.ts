import { describe, expect, it } from 'vitest';
import { applyGeometryCpu, geometryFrame, IDENTITY_GEOMETRY, isIdentityGeometry, validateGeometry, type Geometry } from './geometry';
import { createImage, type LinearImage } from './image';

/** A w x h image whose red channel encodes the pixel index (distinct values), alpha 1. */
function indexed(w: number, h: number): LinearImage {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([i / (w * h), 0.5, 0.25, 1], i * 4);
  return img;
}
const red = (img: LinearImage, x: number, y: number) => img.data[(y * img.width + x) * 4]!;
const srcIndex = (img: LinearImage, x: number, y: number, n: number) => Math.round(red(img, x, y) * n);
const g = (patch: Partial<Geometry>): Geometry => ({ ...IDENTITY_GEOMETRY, ...patch });

describe('geometry', () => {
  const src = indexed(5, 3);

  it('identity keeps the size and every pixel exactly', () => {
    const out = applyGeometryCpu(src, IDENTITY_GEOMETRY);
    expect([out.width, out.height]).toEqual([5, 3]);
    expect([...out.data]).toEqual([...src.data]);
  });

  it('rotates by quarter turns clockwise, swapping the size', () => {
    const r = applyGeometryCpu(src, g({ rotate: 90 }));
    expect([r.width, r.height]).toEqual([3, 5]);
    // Clockwise: the source's bottom-left corner (0, 2) becomes the top-left.
    expect(srcIndex(r, 0, 0, 15)).toBe(2 * 5 + 0);
    expect(srcIndex(r, 2, 0, 15)).toBe(0);
    expect(srcIndex(r, 2, 4, 15)).toBe(4);
    const half = applyGeometryCpu(src, g({ rotate: 180 }));
    expect(srcIndex(half, 0, 0, 15)).toBe(14);
    const back = applyGeometryCpu(applyGeometryCpu(src, g({ rotate: 270 })), g({ rotate: 90 }));
    expect([...back.data]).toEqual([...src.data]);
  });

  it('flips horizontally and vertically', () => {
    expect(srcIndex(applyGeometryCpu(src, g({ flipH: true })), 0, 0, 15)).toBe(4);
    expect(srcIndex(applyGeometryCpu(src, g({ flipV: true })), 0, 0, 15)).toBe(10);
  });

  it('crops a rectangle normalised to the (oriented) frame', () => {
    const c = applyGeometryCpu(indexed(10, 8), g({ crop: { x: 0.2, y: 0.25, width: 0.5, height: 0.5 } }));
    expect([c.width, c.height]).toEqual([5, 4]);
    expect(srcIndex(c, 0, 0, 80)).toBe(2 * 10 + 2);
    expect(srcIndex(c, 4, 3, 80)).toBe(5 * 10 + 6);
    // After a quarter turn the frame is 8 x 10: the crop is taken from it.
    expect([geometryFrame(g({ rotate: 90, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }), 10, 8).width]).toEqual([4]);
  });

  it('straightens about the centre, leaving uncovered corners transparent', () => {
    const img = createImage(21, 21, new Float32Array(21 * 21 * 4).fill(0.5));
    const s = applyGeometryCpu(img, g({ straighten: 30 }));
    expect([s.width, s.height]).toEqual([21, 21]);
    expect(s.data[(10 * 21 + 10) * 4 + 3]).toBeCloseTo(0.5, 6); // centre still covered
    expect(s.data[3]).toBe(0); // corner uncovered
  });

  it('straightens clockwise for positive angles, like rotate', () => {
    // The output point 10 px right of the centre shows the source point up and to the right.
    const { toSource } = geometryFrame(g({ straighten: 30 }), 40, 30);
    const [x, y] = toSource(20 + 10, 15);
    expect(x).toBeCloseTo(20 + 10 * Math.cos(Math.PI / 6), 9);
    expect(y).toBeCloseTo(15 - 10 * Math.sin(Math.PI / 6), 9);
  });

  it('maps the perspective quad onto the frame', () => {
    // Perspective corners = the unit square: identity.
    const id = applyGeometryCpu(src, g({ perspective: [[0, 0], [1, 0], [1, 1], [0, 1]] }));
    for (let i = 0; i < id.data.length; i++) expect(id.data[i]).toBeCloseTo(src.data[i]!, 6);
    // A quad covering the left half: the output shows the left half stretched over the frame.
    const img = indexed(20, 10);
    const left = applyGeometryCpu(img, g({ perspective: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] }));
    // Output pixel (2, 4) has centre (2.5, 4.5) -> source (1.25, 4.5): between source pixels 0 and 1.
    expect(red(left, 2, 4)).toBeCloseTo((4 * 20 + 0.75) / 200, 6);
  });

  it('accepts a crop that touches the edge up to float rounding', () => {
    // UI arithmetic (scaling a crop to an aspect ratio) can land a hair outside [0, 1].
    expect(() => validateGeometry(g({ crop: { x: -1.1e-16, y: 0, width: 0.5, height: 1 + 1e-12 } }))).not.toThrow();
  });

  it('rejects malformed geometry', () => {
    expect(() => validateGeometry(g({ rotate: 45 as never }))).toThrow(/rotate/);
    expect(() => validateGeometry(g({ crop: { x: 0.5, y: 0, width: 0.6, height: 1 } }))).toThrow(/crop/);
    expect(() => validateGeometry(g({ crop: { x: 0, y: 0, width: 0, height: 1 } }))).toThrow(/crop/);
    expect(() => validateGeometry(g({ straighten: 60 }))).toThrow(/straighten/);
    expect(() => validateGeometry(g({ perspective: [[0, 0], [1, 0], [0, 0], [0, 1]] }))).toThrow(/perspective/);
  });

  it('recognises the identity', () => {
    expect(isIdentityGeometry(IDENTITY_GEOMETRY)).toBe(true);
    expect(isIdentityGeometry(g({ perspective: [[0, 0], [1, 0], [1, 1], [0, 1]] }))).toBe(true);
    for (const patch of [{ rotate: 90 }, { flipH: true }, { straighten: 0.5 }, { crop: { x: 0, y: 0, width: 0.9, height: 1 } }, { perspective: [[0.1, 0], [1, 0], [1, 1], [0, 1]] }] as const)
      expect(isIdentityGeometry(g(patch as Partial<Geometry>))).toBe(false);
  });
});
