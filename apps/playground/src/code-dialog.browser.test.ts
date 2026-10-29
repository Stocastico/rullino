import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodeDialog } from './code-dialog';

afterEach(() => document.querySelectorAll('dialog.code-dialog').forEach((d) => d.remove()));

function setup() {
  let doc: unknown = { version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }] };
  const copied: string[] = [];
  const dialog = createCodeDialog({ document: () => doc, copy: async (text) => void copied.push(text) });
  const el = document.querySelector('dialog.code-dialog') as HTMLDialogElement;
  const tab = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((t) => t.textContent === label)!;
  const code = () => el.querySelector('pre code')!.textContent!;
  const install = () => el.querySelector('.code-install')!.textContent!;
  return { dialog, el, tab, code, install, copied, setDoc: (d: unknown) => (doc = d) };
}

describe('code dialog', () => {
  it('opens on the browser snippet with its install line, and switches tabs', () => {
    const { dialog, el, tab, code, install } = setup();
    dialog.open();
    expect(el.open).toBe(true);
    expect(tab('Browser').getAttribute('aria-selected')).toBe('true');
    expect(code()).toContain("from '@rullino/web'");
    expect(install()).toBe('npm install @rullino/web');
    tab('Node').click();
    expect(tab('Node').getAttribute('aria-selected')).toBe('true');
    expect(tab('Browser').getAttribute('aria-selected')).toBe('false');
    expect(code()).toContain("from '@rullino/node'");
    tab('Edit document').click();
    expect(JSON.parse(code())).toEqual({ version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }] });
    expect((el.querySelector('.code-install') as HTMLElement).hidden).toBe(true);
  });

  it('reads the document again on every open, and copies what is shown', async () => {
    const { dialog, el, code, copied, setDoc } = setup();
    dialog.open();
    expect(code()).toContain('"ev": 0.5');
    dialog.close();
    setDoc({ version: 2, steps: [{ filter: 'exposure', params: { ev: 2 } }] });
    dialog.open();
    expect(code()).toContain('"ev": 2');
    (el.querySelector('.code-copy') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(copied).toEqual([code()]);
  });

  it('closes from its button and from close(), and the Copy label comes back', async () => {
    const { dialog, el } = setup();
    dialog.open();
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Close')!.click();
    expect(el.open).toBe(false);
    dialog.open();
    dialog.close();
    expect(el.open).toBe(false);
    vi.useFakeTimers();
    try {
      dialog.open();
      const copy = el.querySelector('.code-copy') as HTMLButtonElement;
      copy.click();
      await vi.waitFor(() => expect(copy.textContent).toBe('Copied'));
      vi.advanceTimersByTime(1500);
      expect(copy.textContent).toBe('Copy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says why when the edit cannot be shown as a document', () => {
    const dialog = createCodeDialog({ document: () => { throw new Error('a loaded .cube file cannot be shared'); }, copy: async () => {} });
    dialog.open();
    const el = document.querySelector('dialog.code-dialog') as HTMLDialogElement;
    expect(el.textContent).toContain('a loaded .cube file cannot be shared');
    expect(el.querySelector('pre')).toBeNull();
  });
});
