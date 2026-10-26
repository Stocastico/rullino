import { defineFilter } from '@rullino/core';
import { afterEach, describe, expect, it } from 'vitest';
import { SELECTION, type ChainState } from './chain-ui';
import { createFilmStrip, type FilmStripHandlers } from './film-strip';

const mk = (id: string) =>
  defineFilter({
    id,
    label: id.toUpperCase(),
    category: 'adjust',
    kind: 'pointwise',
    alpha: 'premultiplied',
    params: {},
    wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return c; }',
    pixel: (c) => c,
    tolerance: { abs: 0, rel: 0 },
  });
const filters = [mk('alpha'), mk('beta'), mk('gamma')];
const step = (uid: string, filterId: string, enabled = true) => ({ uid, filterId, params: {}, enabled });
const state = (selected?: string, extra: Partial<ChainState> = {}): ChainState => ({ steps: [step('a', 'alpha'), step('b', 'beta', false), step('c', 'gamma')], selected, ...extra });

function setup(initial: ChainState = state('b')) {
  const root = document.createElement('div');
  document.body.append(root);
  const calls: unknown[][] = [];
  const handlers: FilmStripHandlers = {
    select: (uid) => calls.push(['select', uid]),
    toggle: (uid, enabled) => calls.push(['toggle', uid, enabled]),
    remove: (uid) => calls.push(['remove', uid]),
    move: (from, to) => calls.push(['move', from, to]),
    add: () => calls.push(['add']),
    solo: (uid) => calls.push(['solo', uid]),
  };
  const strip = createFilmStrip(root, filters, handlers);
  strip.set(initial);
  const frames = () => [...root.querySelectorAll<HTMLElement>('li[data-step]')];
  return { root, strip, calls, frames };
}

afterEach(() => document.body.replaceChildren());

describe('film strip', () => {
  it('shows the original, the selection, a frame per step in order, and an add button', () => {
    const { root, frames } = setup();
    expect(root.querySelector('[data-original]')!.textContent).toContain('Original');
    expect(root.querySelector('[data-selection]')!.textContent).toContain('whole image');
    expect(frames().map((f) => f.querySelector('.step-title')!.textContent)).toEqual(['ALPHA', 'BETA', 'GAMMA']);
    expect(root.querySelector('[data-action=add]')).not.toBeNull();
  });

  it('marks the selected step, disabled steps and the selection', () => {
    const { root, strip, frames } = setup(state('b'));
    expect(frames().map((f) => f.classList.contains('selected'))).toEqual([false, true, false]);
    expect(frames().map((f) => f.classList.contains('disabled'))).toEqual([false, true, false]);
    expect(frames()[1]!.querySelector<HTMLInputElement>('[data-action=toggle]')!.checked).toBe(false);
    strip.set(state(SELECTION, { selection: { kind: 'linear', from: [0, 0], to: [1, 1] } as never }));
    expect(root.querySelector('[data-selection]')!.classList.contains('selected')).toBe(true);
    expect(root.querySelector('[data-selection]')!.textContent).toContain('set');
  });

  it('reports clicks: select, toggle, remove, add, selection', () => {
    const { root, calls, frames } = setup();
    frames()[2]!.querySelector<HTMLElement>('.step-title')!.click();
    const toggle = frames()[0]!.querySelector<HTMLInputElement>('[data-action=toggle]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    frames()[1]!.querySelector<HTMLElement>('[data-action=remove]')!.click();
    root.querySelector<HTMLElement>('[data-action=add]')!.click();
    root.querySelector<HTMLElement>('[data-selection] [data-action=select]')!.click();
    expect(calls).toEqual([['select', 'c'], ['toggle', 'a', false], ['remove', 'b'], ['add'], ['select', SELECTION]]);
  });

  it('solo: a frame asks to show the photo up to it, and asks to show everything again when pressed twice', () => {
    const { strip, calls, frames } = setup();
    frames()[1]!.querySelector<HTMLElement>('[data-action=solo]')!.click();
    expect(calls.at(-1)).toEqual(['solo', 'b']);
    strip.setSolo('b');
    expect(frames()[1]!.querySelector('[data-action=solo]')!.getAttribute('aria-pressed')).toBe('true');
    expect(frames()[0]!.querySelector('[data-action=solo]')!.getAttribute('aria-pressed')).toBe('false');
    // The frames after it are dimmed: they are not in the picture.
    expect(frames().map((f) => f.classList.contains('beyond'))).toEqual([false, false, true]);
    strip.setSolo(undefined);
    expect(frames().some((f) => f.classList.contains('beyond'))).toBe(false);
    strip.setSolo('b');
    frames()[1]!.querySelector<HTMLElement>('[data-action=solo]')!.click();
    expect(calls.at(-1)).toEqual(['solo', undefined]);
  });

  it('Alt+arrows move the focused step', () => {
    const { calls, frames } = setup();
    const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey: true, bubbles: true, cancelable: true }));
    key(frames()[1]!.querySelector('.step-title')!, 'ArrowLeft');
    key(frames()[1]!.querySelector('.step-title')!, 'ArrowRight');
    key(frames()[0]!.querySelector('.step-title')!, 'ArrowLeft'); // already first: nothing
    key(frames()[2]!.querySelector('.step-title')!, 'ArrowRight'); // already last: nothing
    expect(calls).toEqual([['move', 1, 0], ['move', 1, 2]]);
  });

  it('dragging a frame onto another moves it before or after, depending on the side', () => {
    const { calls, frames } = setup();
    const drag = (from: number, onto: number, atFraction: number) => {
      const dt = new DataTransfer();
      const target = frames()[onto]!;
      const r = target.getBoundingClientRect();
      const clientX = r.left + r.width * atFraction;
      frames()[from]!.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX, bubbles: true, cancelable: true }));
      frames()[from]!.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    };
    drag(0, 2, 0.8); // first onto the right half of the last: ends up last
    drag(2, 0, 0.2); // last onto the left half of the first: ends up first
    drag(1, 1, 0.5); // onto itself: nothing
    drag(0, 1, 0.2); // before its right neighbour: where it already is, nothing
    expect(calls).toEqual([['move', 0, 2], ['move', 2, 0]]);
  });

  it('draws the thumbnails it is given, and keeps them when the chain is redrawn', () => {
    const { root, strip, frames } = setup();
    const img = (v: number) => {
      const d = new ImageData(2, 2);
      for (let i = 0; i < d.data.length; i += 4) d.data.set([v, v, v, 255], i);
      return d;
    };
    strip.setThumbnails(img(255), new Map([['a', img(200)], ['c', img(100)]]));
    const px = (el: Element) => el.querySelector('canvas')!.getContext('2d')!.getImageData(0, 0, 1, 1).data[0];
    expect(px(root.querySelector('[data-original]')!)).toBe(255);
    expect([px(frames()[0]!), px(frames()[2]!)]).toEqual([200, 100]);
    expect(frames()[1]!.querySelector('canvas')!.dataset.ready).toBeUndefined();
    strip.set(state('a'));
    expect(px(frames()[0]!)).toBe(200);
  });

  it('tells how to start when there are no steps', () => {
    const { root } = setup({ steps: [], selected: undefined });
    expect(root.querySelectorAll('li[data-step]')).toHaveLength(0);
    expect(root.textContent).toContain('Add an effect');
  });
});
