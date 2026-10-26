import { defineFilter } from '@rullino/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createEffectBrowser } from './effect-browser';

const mk = (id: string, label: string, description: string, over: Record<string, unknown> = {}) =>
  defineFilter({
    id,
    label,
    description,
    tryThis: `Try ${label}.`,
    category: 'adjust',
    kind: 'pointwise',
    alpha: 'premultiplied',
    params: { k: { type: 'float', min: 0, max: 2, step: 0.1, default: 1, label: 'K' } },
    wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return c; }',
    pixel: (c) => c,
    tolerance: { abs: 0, rel: 0 },
    ...over,
  });
const filters = [mk('alpha', 'Alpha', 'First one.'), mk('beta', 'Beta', 'Second one.'), mk('gamma', 'Gamma', 'Third one.')];

const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

function setup(thumbnails = async (fs: readonly unknown[]) => fs.map(() => new ImageData(4, 3))) {
  const picked: string[] = [];
  const browser = createEffectBrowser({ filters, thumbnails: thumbnails as never, onPick: (f) => picked.push(f.id) });
  const dialog = document.querySelector('dialog.effect-browser') as HTMLDialogElement;
  const search = dialog.querySelector('input[type=search]') as HTMLInputElement;
  const cards = () => [...dialog.querySelectorAll<HTMLButtonElement>('.effect-card')].filter((c) => !c.hidden);
  const type = (text: string) => {
    search.value = text;
    search.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { browser, dialog, search, cards, type, picked };
}

afterEach(() => document.querySelectorAll('dialog.effect-browser').forEach((d) => d.remove()));

describe('effect browser', () => {
  it('opens with every effect, its description and a thumbnail, and filters as you type', async () => {
    const { browser, dialog, cards, type } = setup();
    expect(dialog.open).toBe(false);
    browser.open();
    expect(dialog.open).toBe(true);
    expect(cards().map((c) => c.dataset.filter)).toEqual(['alpha', 'beta', 'gamma']);
    expect(cards()[0]!.textContent).toContain('First one.');
    await new Promise((r) => setTimeout(r, 50));
    expect(cards()[0]!.querySelector('canvas')!.dataset.ready).toBeDefined();
    type('second');
    expect(cards().map((c) => c.dataset.filter)).toEqual(['beta']);
    type('zzz');
    expect(cards()).toEqual([]);
    expect(dialog.querySelector('.effect-empty')!.hasAttribute('hidden')).toBe(false);
  });

  it('adds the effect on click and closes; Enter adds the first match; Escape closes without adding', () => {
    const { browser, dialog, search, cards, type, picked } = setup();
    browser.open();
    cards()[1]!.click();
    expect(picked).toEqual(['beta']);
    expect(dialog.open).toBe(false);

    browser.open();
    type('gam');
    key(search, 'Enter');
    expect(picked).toEqual(['beta', 'gamma']);
    expect(dialog.open).toBe(false);

    browser.open();
    key(dialog, 'Escape');
    dialog.close();
    expect(picked).toEqual(['beta', 'gamma']);
  });

  it('arrow keys move through the results', () => {
    const { browser, search, cards, picked } = setup();
    browser.open();
    key(search, 'ArrowDown');
    expect(document.activeElement).toBe(cards()[0]);
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(cards()[1]);
    key(document.activeElement!, 'ArrowUp');
    key(document.activeElement!, 'ArrowUp');
    expect(document.activeElement).toBe(search);
    expect(picked).toEqual([]);
  });

  it('opens and closes with Ctrl+K and Cmd+K', () => {
    const { dialog } = setup();
    key(document, 'k', { ctrlKey: true });
    expect(dialog.open).toBe(true);
    key(document, 'k', { metaKey: true });
    expect(dialog.open).toBe(false);
    key(document, 'k');
    expect(dialog.open).toBe(false);
  });

  it('loads thumbnails in small batches, only for effects that can have one, and again after invalidate()', async () => {
    const calls: string[][] = [];
    const withMask = { ...filters[0]!, id: 'masked', label: 'Masked', description: 'Needs a mask.', kind: 'multipass', usesMask: true, passes: [] } as never;
    const browser = createEffectBrowser({
      filters: [...filters, withMask],
      thumbnails: (async (fs: readonly { id: string }[]) => {
        calls.push(fs.map((f) => f.id));
        return fs.map(() => new ImageData(4, 3));
      }) as never,
      onPick: () => {},
    });
    browser.open();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.flat()).toEqual(['alpha', 'beta', 'gamma']);
    browser.close();
    browser.open();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(1);
    browser.invalidate();
    browser.open();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.length).toBe(2);
    const cardMasked = document.querySelector<HTMLElement>('[data-filter=masked]')!;
    expect(cardMasked.querySelector('canvas')).toBeNull();
  });
});
