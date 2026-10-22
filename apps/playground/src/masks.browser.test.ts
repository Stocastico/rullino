import { createImage, createRasterMask, type LinearMask, type Mask, type RadialMask, type RasterMask, type Vec2 } from '@rullino/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createMaskOverlay } from './mask-overlay';
import { DEFAULT_MASKS, emptyBrush, fitRaster, renderMaskControls, setImageSize, setMaskSource, tools, wandAt } from './mask-ui';
import { at, press, svgBox } from './test-utils';

const round = (o: unknown) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
const coverage = (m: Mask) => (m as RasterMask).raster.data.reduce((a, b) => a + b, 0);

afterEach(() => {
  Object.assign(tools, { tool: 'paint', radius: 0.04, hardness: 0.5, tolerance: 0.1, contiguous: true });
  setImageSize(1, 1);
});

describe('mask overlay', () => {
  const setup = (mask: Mask | undefined, wandCalls: [Vec2, boolean][] = [], objectCalls: [Vec2, boolean][] = []) => {
    const svg = svgBox(200, 100);
    const changes: Mask[] = [];
    let drags = 0;
    const overlay = createMaskOverlay(svg, (m) => changes.push(m), () => drags++, {
      tool: () => tools.tool,
      brush: () => ({ radius: 0.05, hardness: 1, erase: false }),
      wand: (uv, subtract) => wandCalls.push([uv, subtract]),
      object: (uv, subtract) => objectCalls.push([uv, subtract]),
      fit: (m) => m,
    });
    overlay.show(mask, 400, 200);
    return { svg, changes, overlay, drags: () => drags, handle: (n: string) => svg.querySelector(`[data-handle=${n}]`)! };
  };

  it('drags the ends of a linear gradient (clamped), refusing to make them coincide', () => {
    const { svg, changes, handle, drags } = setup(DEFAULT_MASKS.linear as LinearMask);
    expect(handle('from').getAttribute('cy')).toBe('50');
    const g = press(handle('from'), ...at(svg, 0.5, 0.25));
    g.move(...at(svg, 0.2, -1));
    g.move(...at(svg, 0.5, 0.75)); // onto 'to': refused
    g.up();
    expect(drags()).toBe(1);
    expect(round(changes.map((m) => (m as LinearMask).from))).toEqual([[0.2, 0]]);
    expect(svg.querySelectorAll('.mask-edge').length).toBe(2);
  });

  it('moves a radial mask and resizes its axes in units of the longer side', () => {
    const { svg, changes, handle } = setup(DEFAULT_MASKS.radial as RadialMask);
    const c = press(handle('center'), ...at(svg, 0.5, 0.5));
    c.move(...at(svg, 0.4, 0.6));
    c.up();
    expect(round((changes.at(-1) as RadialMask).center)).toEqual([0.4, 0.6]);
    const rx = press(handle('rx'), 0, 0);
    rx.move(...at(svg, 0.9, 0.6));
    rx.up();
    // |0.9 − 0.4| · 400 px / 400 px (longer side)
    expect((changes.at(-1) as RadialMask).radius[0]).toBeCloseTo(0.5, 3);
    const ry = press(handle('ry'), 0, 0);
    ry.move(...at(svg, 0.4, 0.6)); // zero: kept at the minimum
    ry.up();
    expect((changes.at(-1) as RadialMask).radius[1]).toBeCloseTo(0.01, 6);
  });

  it('paints a brush stroke, and sends wand clicks (Alt subtracts) to the caller', () => {
    const wandCalls: [Vec2, boolean][] = [];
    const { svg, changes, overlay } = setup({ kind: 'raster', raster: createRasterMask(40, 20) }, wandCalls);
    expect(svg.classList.contains('painting')).toBe(true);
    const g = press(svg, ...at(svg, 0.2, 0.5));
    g.move(...at(svg, 0.8, 0.5));
    g.up();
    expect(changes.length).toBe(2);
    expect(coverage(changes.at(-1)!)).toBeGreaterThan(coverage(changes[0]!));
    svg.dispatchEvent(new PointerEvent('pointerleave'));
    tools.tool = 'wand';
    svg.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    expect(svg.classList.contains('wand')).toBe(true);
    press(svg, ...at(svg, 0.5, 0.5), { altKey: true });
    expect(round(wandCalls)).toEqual([[[0.5, 0.5], true]]);
    const objectCalls: [Vec2, boolean][] = [];
    const other = setup({ kind: 'raster', raster: createRasterMask(40, 20) }, [], objectCalls);
    tools.tool = 'object';
    press(other.svg, ...at(other.svg, 0.25, 0.75));
    press(other.svg, ...at(other.svg, 0.5, 0.5), { altKey: true });
    expect(round(objectCalls)).toEqual([[[0.25, 0.75], false], [[0.5, 0.5], true]]);
    expect(other.changes).toHaveLength(0); // no painting in object mode
    // Switching kind rebuilds: no more brush handlers.
    overlay.show(undefined, 400, 200);
    expect([svg.children.length, svg.classList.contains('painting'), svg.onpointerdown]).toEqual([0, false, null]);
  });
});

describe('mask panel', () => {
  const setup = (initial: Mask | undefined, required = false) => {
    const root = document.createElement('div');
    document.body.append(root);
    let mask = initial;
    renderMaskControls(root, () => mask, (m) => (mask = m), required);
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s);
    const change = (el: HTMLElement | null, value: string | boolean, type = 'change') => {
      if (typeof value === 'boolean') (el as HTMLInputElement).checked = value;
      else (el as HTMLInputElement).value = value;
      el!.dispatchEvent(new Event(type));
    };
    return { root, q, change, mask: () => mask };
  };

  it('switches kinds keeping invert and opacity; required masks offer no "none"', () => {
    const { q, change, mask } = setup(undefined);
    change(q('[data-action=mask-kind]'), 'radial');
    expect(mask()?.kind).toBe('radial');
    change(q('[data-action=mask-invert]'), true);
    change(q('[data-action=mask-opacity]'), '0.4', 'input');
    change(q('[data-action=mask-feather]'), '0.1', 'input');
    expect(round(mask())).toMatchObject({ invert: true, opacity: 0.4, feather: 0.1 });
    change(q('[data-action=mask-kind]'), 'linear');
    expect(mask()).toMatchObject({ kind: 'linear', invert: true, opacity: 0.4 });
    change(q('[data-action=mask-kind]'), 'none');
    expect(mask()).toBeUndefined();
    const required = setup(emptyBrush(), true);
    expect([...required.q<HTMLSelectElement>('[data-action=mask-kind]')!.options].map((o) => o.value)).toEqual(['linear', 'radial', 'brush']);
  });

  it('the Object tool starts a new object session when chosen and on "New object"', () => {
    const { q } = setup({ kind: 'raster', raster: createRasterMask(4, 4) });
    const before = tools.objectSession;
    q<HTMLButtonElement>('[data-action=tool-object]')!.click();
    expect([tools.tool, tools.objectSession]).toEqual(['object', before + 1]);
    q<HTMLButtonElement>('[data-action=object-new]')!.click();
    expect(tools.objectSession).toBe(before + 2);
  });

  it('brush masks have tools, size / hardness / tolerance settings, clear and refine', async () => {
    setImageSize(300, 100);
    const brush: RasterMask = { kind: 'raster', raster: createRasterMask(30, 10, new Float32Array(300).fill(1)) };
    const { q, change, mask } = setup(brush);
    change(q('[data-action=brush-size]'), '0.5', 'input');
    change(q('[data-action=brush-hardness]'), '0.9', 'input');
    expect([tools.radius, tools.hardness]).toEqual([0.125, 0.9]);
    q<HTMLButtonElement>('[data-action=tool-wand]')!.click();
    expect(tools.tool).toBe('wand');
    change(q('[data-action=wand-tolerance]'), '0.5', 'input');
    expect(tools.tolerance).toBe(0.25);
    q<HTMLButtonElement>('[data-action=mask-clear]')!.click();
    expect(coverage(mask()!)).toBe(0);
    // A cleared brush gets the image's size (never enlarged past it).
    expect([(mask() as RasterMask).raster.width, (mask() as RasterMask).raster.height]).toEqual([300, 100]);
    // Without an image source, refining does nothing.
    q<HTMLButtonElement>('[data-action=mask-refine]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(coverage(mask()!)).toBe(0);
  });

  it('the wand and refinement read the image at the raster size', async () => {
    setImageSize(20, 10);
    // Left half red, right half blue.
    const image = createImage(16, 8);
    for (let i = 0; i < 16 * 8; i++) image.data.set(i % 16 < 8 ? [1, 0, 0, 1] : [0, 0, 1, 1], i * 4);
    setMaskSource(async () => image);
    const empty = { kind: 'raster', raster: createRasterMask(4, 4) } as RasterMask;
    const fitted = fitRaster(empty);
    expect([fitted.raster.width, fitted.raster.height]).toEqual([20, 10]);
    expect(fitRaster(fitted)).toBe(fitted);
    const sizes: number[][] = [];
    setMaskSource(async (w, h) => {
      sizes.push([w, h]);
      return createImage(w, h, new Float32Array(w * h * 4).fill(1));
    });
    const selected = (await wandAt(empty, [0.25, 0.5], false)) as RasterMask;
    expect(sizes[0]).toEqual([20, 10]);
    expect(coverage(selected)).toBeGreaterThan(150);
    expect(coverage((await wandAt(selected, [0.25, 0.5], true))!)).toBe(0);
  });
});
