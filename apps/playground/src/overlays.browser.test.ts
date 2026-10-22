import { IDENTITY_GEOMETRY, type Geometry } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { createCropOverlay, fitAspect } from './crop-overlay';
import { renderGeometryControls, type Aspect, type EditMode } from './geometry-ui';
import { drawHistogram } from './histogram-view';
import { createPerspectiveOverlay, UNIT_QUAD, type Quad } from './perspective-overlay';
import { at, press, svgBox } from './test-utils';

const round = (o: object) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));

describe('drawHistogram', () => {
  it('sizes the canvas, draws the channels and records the mean luminosity', () => {
    const canvas = document.createElement('canvas');
    const bins = () => new Uint32Array(256);
    const h = { red: bins(), green: bins(), blue: bins(), luma: bins(), count: 4 };
    h.red[10] = 4;
    h.luma[100] = 2;
    h.luma[200] = 2;
    drawHistogram(canvas, h);
    expect([canvas.width, canvas.height]).toEqual([256, 100]);
    expect(canvas.dataset.mean).toBe('150.0');
    const px = canvas.getContext('2d')!.getImageData(10, 99, 1, 1).data;
    expect(px[0]).toBeGreaterThan(100); // the red bar
    drawHistogram(canvas, { ...h, count: 0 });
    expect(canvas.dataset.mean).toBe('0');
  });
});

describe('crop overlay', () => {
  const setup = () => {
    const svg = svgBox(200, 100);
    const changes: Geometry['crop'][] = [];
    const overlay = createCropOverlay(svg, (c) => changes.push(c));
    overlay.show({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 400, 200, undefined);
    const handle = (name: string) => svg.querySelector(`[data-handle=${name}]`)!;
    return { svg, changes, overlay, handle };
  };

  it('shows a shaded frame with four corner handles in frame pixels, and hides', () => {
    const { svg, overlay, handle } = setup();
    expect(svg.getAttribute('viewBox')).toBe('0 0 400 200');
    expect([handle('tl').getAttribute('cx'), handle('br').getAttribute('cy')]).toEqual(['100', '150']);
    overlay.hide();
    expect(svg.children.length).toBe(0);
  });

  it('moves the body inside the frame and drags corners against the opposite one', () => {
    const { svg, changes, handle } = setup();
    const body = svg.querySelector('.crop-body')!;
    const g = press(body, ...at(svg, 0.5, 0.5));
    g.move(...at(svg, 0.6, 0.55));
    g.move(...at(svg, 2, 2)); // clamped to the frame
    g.up();
    expect(round(changes.at(-1)!)).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    const c = press(handle('tl'), ...at(svg, 0.5, 0.5));
    c.move(...at(svg, 0.25, 0.75));
    c.up();
    // The bottom-right corner (1, 1) stays put.
    expect(round(changes.at(-1)!)).toEqual({ x: 0.25, y: 0.75, width: 0.75, height: 0.25 });
  });

  it('keeps a size minimum and the aspect ratio while dragging a corner', () => {
    const svg = svgBox(200, 100);
    const changes: Geometry['crop'][] = [];
    const overlay = createCropOverlay(svg, (c) => changes.push(c));
    overlay.show({ x: 0, y: 0, width: 1, height: 1 }, 400, 200, 1);
    const g = press(svg.querySelector('[data-handle=br]')!, ...at(svg, 1, 1));
    g.move(...at(svg, 0.3, 0.9));
    g.up();
    const c = changes.at(-1)!;
    expect((c.width * 400) / (c.height * 200)).toBeCloseTo(1, 6);
    overlay.show({ x: 0, y: 0, width: 1, height: 1 }, 400, 200, undefined);
    const tiny = press(svg.querySelector('[data-handle=br]')!, ...at(svg, 1, 1));
    tiny.move(...at(svg, -1, -1));
    tiny.up();
    expect(changes.at(-1)!.width).toBeCloseTo(0.02, 6);
  });

  it('fitAspect returns the largest centred rectangle of a pixel aspect', () => {
    expect(round(fitAspect({ x: 0, y: 0, width: 1, height: 1 }, 400, 200, 1))).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(round(fitAspect({ x: 0, y: 0, width: 1, height: 1 }, 400, 200, 4))).toEqual({ x: 0, y: 0.25, width: 1, height: 0.5 });
  });
});

describe('perspective overlay', () => {
  it('moves a corner, refuses non-convex quads and clamps to the frame', () => {
    const svg = svgBox(200, 200);
    const quads: Quad[] = [];
    const overlay = createPerspectiveOverlay(svg, (q) => quads.push(q));
    overlay.show(UNIT_QUAD, 100, 100);
    expect(svg.querySelectorAll('[data-handle]').length).toBe(4);
    const p0 = svg.querySelector('[data-handle=p0]')!;
    const g = press(p0, ...at(svg, 0, 0));
    g.move(...at(svg, 0.1, 0.2));
    g.move(...at(svg, 0.9, 0.9)); // past the opposite corner: not convex, refused
    g.move(...at(svg, -1, -1)); // clamped to (0, 0)
    g.up();
    expect(round(quads)).toEqual([round([[0.1, 0.2], [1, 0], [1, 1], [0, 1]]), round(UNIT_QUAD)]);
    expect(p0.getAttribute('cx')).toBe('0');
    overlay.hide();
    expect(svg.children.length).toBe(0);
  });
});

describe('geometry panel', () => {
  const setup = () => {
    const root = document.createElement('div');
    document.body.append(root);
    let geometry: Geometry = IDENTITY_GEOMETRY;
    let mode: EditMode = 'none';
    const log: unknown[] = [];
    const controls = renderGeometryControls(
      root,
      () => geometry,
      (g, dragging) => {
        geometry = g;
        log.push(dragging ? 'drag' : 'commit');
      },
      { mode: () => mode, setMode: (m) => (mode = m), setAspect: (a: Aspect) => log.push(a) },
    );
    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    return { root, q, log, controls, get: () => geometry, mode: () => mode };
  };

  it('turns and flips what is shown, resets, and straightens while dragging', () => {
    const { q, get, log } = setup();
    q<HTMLButtonElement>('[data-action=rotate-right]').click();
    expect(get().rotate).toBe(90);
    q<HTMLButtonElement>('[data-action=rotate-left]').click();
    q<HTMLButtonElement>('[data-action=flip-h]').click();
    q<HTMLButtonElement>('[data-action=flip-v]').click();
    expect([get().rotate, get().flipH, get().flipV]).toEqual([0, true, true]);
    const s = q<HTMLInputElement>('[data-action=straighten]');
    s.value = '12.5';
    s.dispatchEvent(new Event('input'));
    expect(get().straighten).toBe(12.5);
    expect(log.at(-1)).toBe('drag');
    s.dispatchEvent(new Event('dblclick'));
    expect(get().straighten).toBe(0);
    q<HTMLButtonElement>('[data-action=geometry-reset]').click();
    expect(get()).toBe(IDENTITY_GEOMETRY);
  });

  it('toggles crop / perspective mode: Done label, the other button disabled; aspect goes to the editor', () => {
    const { q, mode, log } = setup();
    q<HTMLButtonElement>('[data-action=crop-mode]').click();
    expect(mode()).toBe('crop');
    expect(q<HTMLButtonElement>('[data-action=crop-done]').textContent).toBe('Done');
    expect(q<HTMLButtonElement>('[data-action=perspective-mode]').disabled).toBe(true);
    q<HTMLButtonElement>('[data-action=crop-done]').click();
    expect(mode()).toBe('none');
    const aspect = q<HTMLSelectElement>('[data-action=crop-aspect]');
    aspect.value = '16:9';
    aspect.dispatchEvent(new Event('change'));
    expect(log.at(-1)).toBe('16:9');
  });
});
