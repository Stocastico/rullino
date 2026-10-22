import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachZoom, FIT, updateHandleScale, type View } from './zoom';
import { press } from './test-utils';

function setup() {
  const viewport = document.createElement('div');
  viewport.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 400px; height: 200px; overflow: hidden');
  const stage = document.createElement('div');
  stage.setAttribute('style', 'width: 400px; height: 200px; transform-origin: 0 0');
  viewport.append(stage);
  document.body.append(viewport);
  const views: View[] = [];
  const zoom = attachZoom(viewport, stage, (v) => views.push(v));
  const wheel = (init: WheelEventInit) => viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
  return { viewport, stage, zoom, views, wheel };
}

afterEach(() => {
  document.body.replaceChildren();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
});

describe('attachZoom', () => {
  it('Ctrl+wheel zooms about the cursor; the transform follows', () => {
    const { stage, zoom, wheel } = setup();
    wheel({ ctrlKey: true, deltaY: -100, clientX: 0, clientY: 0 });
    expect(zoom.view.zoom).toBeCloseTo(Math.exp(0.5), 6);
    expect([zoom.view.x, zoom.view.y]).toEqual([0, 0]);
    expect(stage.style.transform).toContain('scale(');
    expect(stage.classList.contains('zoomed')).toBe(true);
    // Line-mode deltas (Firefox) are scaled to pixels, and capped.
    wheel({ ctrlKey: true, deltaY: 10, deltaMode: 1, clientX: 0, clientY: 0 });
    expect(zoom.view.zoom).toBeCloseTo(1, 6);
    expect(stage.style.transform).toBe('');
  });

  it('a plain wheel pans only when zoomed (otherwise the page scrolls)', () => {
    const { zoom, wheel } = setup();
    expect(wheel({ deltaY: 50 })).toBe(true); // not cancelled
    zoom.set({ zoom: 2, x: -100, y: -50 });
    expect(wheel({ deltaX: 30, deltaY: 20 })).toBe(false);
    expect([zoom.view.x, zoom.view.y]).toEqual([-130, -70]);
  });

  it('zoomBy zooms about the visible centre; set clamps', () => {
    const { zoom } = setup();
    zoom.zoomBy(2);
    expect(zoom.view).toEqual({ zoom: 2, x: -200, y: -100 });
    zoom.set({ zoom: 100, x: 50, y: 50 });
    expect(zoom.view).toEqual({ zoom: 32, x: 0, y: 0 });
    zoom.set(FIT);
  });

  it('Space + drag and middle-button drag pan; typing a space in a text field does not', () => {
    const { stage, zoom } = setup();
    zoom.set({ zoom: 2, x: -100, y: -50 });
    const input = Object.assign(document.createElement('input'), { type: 'text' });
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(stage.classList.contains('panning')).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(stage.classList.contains('panning')).toBe(true);
    const g = press(stage, 100, 100);
    g.move(120, 90);
    g.up();
    expect([zoom.view.x, zoom.view.y]).toEqual([-80, -60]);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    const m = press(stage, 100, 100, { button: 1 });
    m.move(90, 100);
    m.up();
    expect(zoom.view.x).toBe(-90);
    // Plain left drag without Space: not a pan.
    const l = press(stage, 100, 100);
    l.move(150, 150);
    l.up();
    expect(zoom.view.x).toBe(-90);
  });

  it('two touches pinch-zoom about their midpoint and pan with it', () => {
    const { stage, zoom } = setup();
    const t = (type: string, id: number, x: number, y = 100) =>
      stage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y }));
    t('pointerdown', 1, 180);
    t('pointermove', 1, 180); // one finger: nothing
    expect(zoom.view.zoom).toBe(1);
    t('pointerdown', 2, 220);
    t('pointermove', 2, 260); // 40 → 80 px apart
    expect(zoom.view.zoom).toBeCloseTo(2, 6);
    t('pointerup', 2, 260);
    t('pointerup', 1, 180);
    t('pointermove', 1, 300);
    expect(zoom.view.zoom).toBeCloseTo(2, 6);
  });
});

describe('updateHandleScale', () => {
  it('sets --px to image pixels per screen pixel, skipping SVGs without a viewBox', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'width: 200px; height: 100px');
    svg.setAttribute('viewBox', '0 0 800 400');
    const bare = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg, bare);
    updateHandleScale([svg, bare]);
    expect(svg.style.getPropertyValue('--px')).toBe('4');
    expect(bare.style.getPropertyValue('--px')).toBe('');
  });
});

describe('the stage resizing', () => {
  it('re-clamps the view through a ResizeObserver', async () => {
    const { stage, zoom } = setup();
    zoom.set({ zoom: 2, x: -400, y: -200 });
    stage.style.width = '100px';
    await vi.waitFor(() => expect(zoom.view.x).toBe(-100));
  });
});
