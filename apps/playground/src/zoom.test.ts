import { describe, expect, it } from 'vitest';
import { clampView, FIT, panBy, zoomAt } from './zoom';

const W = 400;
const H = 200;

describe('zoom view', () => {
  it('zooming about a point keeps that point under the cursor', () => {
    const v = zoomAt(FIT, 4, 100, 50, W, H);
    expect(v.zoom).toBe(4);
    // Stage point (100, 50) maps to screen x = v.x + 100 * zoom.
    expect(v.x + 100 * v.zoom).toBeCloseTo(100);
    expect(v.y + 50 * v.zoom).toBeCloseTo(50);
  });

  it('zoom is clamped to [1, max] and zooming back out to 1 recentres', () => {
    expect(zoomAt(FIT, 0.5, 10, 10, W, H)).toEqual(FIT);
    expect(zoomAt(FIT, 1000, 10, 10, W, H).zoom).toBe(32);
    const v = zoomAt(zoomAt(FIT, 3, 300, 150, W, H), 1 / 3, 0, 0, W, H);
    expect(v.zoom).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
  });

  it('panning never shows past the image edges', () => {
    const v = zoomAt(FIT, 2, 0, 0, W, H);
    expect(panBy(v, 1000, 1000, W, H)).toMatchObject({ x: 0, y: 0 });
    expect(panBy(v, -1000, -1000, W, H)).toMatchObject({ x: -W, y: -H });
    expect(panBy(v, -30, -20, W, H)).toMatchObject({ x: -30, y: -20 });
  });

  it('clampView fixes a view after the stage shrank', () => {
    expect(clampView({ zoom: 2, x: -900, y: 10 }, W, H)).toEqual({ zoom: 2, x: -W, y: 0 });
  });
});
