import { type Filter } from '@rullino/core';
import { CATEGORY_LABELS, searchEffects } from './effect-search';

export interface EffectBrowserOptions {
  filters: readonly Filter<any>[];
  /** Thumbnails of the effects (at their preview values) on the current image; undefined where none can be made yet. */
  thumbnails(filters: readonly Filter<any>[]): Promise<(ImageData | undefined)[]>;
  onPick(filter: Filter<any>): void;
}

export interface EffectBrowser {
  open(): void;
  close(): void;
  /** The image changed: thumbnails are drawn again the next time the browser opens. */
  invalidate(): void;
}

/** Whether an effect can be shown on a thumbnail by itself (no mask, depth map or LUT file needed). */
export const hasThumbnail = (f: Filter<any>): boolean =>
  f.id !== 'applyLut' && !('usesMask' in f && f.usesMask) && !Object.values(f.params).some((p) => (p as { type: string }).type === 'image');

const BATCH = 6;

/**
 * A searchable dialog of every effect, each on a thumbnail of the current image with its
 * description; click or Enter adds it. Ctrl/⌘ + K opens and closes it from anywhere.
 */
export function createEffectBrowser({ filters, thumbnails, onPick }: EffectBrowserOptions): EffectBrowser {
  const dialog = Object.assign(document.createElement('dialog'), { className: 'effect-browser' });
  dialog.setAttribute('aria-label', 'Add an effect');
  const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Search effects: blur, dots, warm, edges…', autocomplete: 'off' });
  search.setAttribute('aria-label', 'Search effects');
  const grid = Object.assign(document.createElement('div'), { className: 'effect-grid' });
  const empty = Object.assign(document.createElement('p'), { className: 'effect-empty', textContent: 'No effect matches. Try a plainer word, such as blur, edges or colour.' });
  empty.hidden = true;
  dialog.append(search, grid, empty);

  const cards = new Map<string, HTMLButtonElement>();
  const canvases = new Map<string, HTMLCanvasElement>();
  for (const f of filters) {
    const card = Object.assign(document.createElement('button'), { type: 'button', className: 'effect-card' });
    card.dataset.filter = f.id;
    if (hasThumbnail(f)) {
      const canvas = document.createElement('canvas');
      canvases.set(f.id, canvas);
      card.append(canvas);
    }
    const text = document.createElement('span');
    text.className = 'effect-text';
    text.append(
      Object.assign(document.createElement('strong'), { textContent: f.label }),
      Object.assign(document.createElement('small'), { textContent: CATEGORY_LABELS[f.category] ?? f.category }),
      Object.assign(document.createElement('span'), { textContent: f.description ?? '' }),
    );
    card.append(text);
    card.addEventListener('click', () => {
      dialog.close();
      onPick(f);
    });
    cards.set(f.id, card);
    grid.append(card);
  }

  const visible = () => [...cards.values()].filter((c) => !c.hidden);
  function filter(): void {
    const matches = new Set(searchEffects(filters, search.value).map((f) => f.id));
    const order = searchEffects(filters, search.value);
    for (const [id, card] of cards) card.hidden = !matches.has(id);
    // Best matches first; with no query, the registry's order.
    for (const f of order) grid.append(cards.get(f.id)!);
    empty.hidden = matches.size > 0;
  }
  search.addEventListener('input', filter);

  let stale = true;
  let loading = false;
  async function loadThumbnails(): Promise<void> {
    if (!stale || loading) return;
    loading = true;
    stale = false;
    try {
      const todo = filters.filter(hasThumbnail);
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const images = await thumbnails(batch);
        if (stale) return; // invalidated meanwhile: start again on the next open
        batch.forEach((f, j) => {
          const img = images[j];
          const canvas = canvases.get(f.id);
          if (!img || !canvas) return;
          [canvas.width, canvas.height] = [img.width, img.height];
          canvas.getContext('2d')!.putImageData(img, 0, 0);
          canvas.dataset.ready = '';
        });
      }
    } catch (e) {
      stale = true;
      console.error(e);
    } finally {
      loading = false;
      if (stale && dialog.open) void loadThumbnails(); // invalidated while loading
    }
  }

  dialog.addEventListener('keydown', (e) => {
    const list = visible();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Enter' && e.target === search) {
      e.preventDefault();
      list[0]?.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[Math.min(list.length - 1, at + 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (at <= 0) search.focus();
      else list[at - 1]!.focus();
    }
  });
  // A click on the backdrop (outside the content box) closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.body.append(dialog);
  const api: EffectBrowser = {
    open() {
      if (dialog.open) return;
      search.value = '';
      filter();
      dialog.showModal();
      search.focus();
      void loadThumbnails();
    },
    close: () => dialog.close(),
    invalidate() {
      stale = true;
      if (dialog.open) void loadThumbnails(); // open while the image changed: redraw now
    },
  };
  document.addEventListener('keydown', (e) => {
    if (!dialog.isConnected) return; // a browser whose dialog was removed (tests) must not answer
    if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else api.open();
    }
  });
  return api;
}
