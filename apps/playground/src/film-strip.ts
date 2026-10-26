import type { Filter } from '@rullino/core';
import { SELECTION, type ChainState } from './chain-ui';

export interface FilmStripHandlers {
  /** A step's uid, or SELECTION. */
  select(uid: string): void;
  toggle(uid: string, enabled: boolean): void;
  remove(uid: string): void;
  /** Moves the step at `from` so that it ends up at index `to`. */
  move(from: number, to: number): void;
  add(): void;
  /** Show the photo as it is after this step (undefined: show everything again). */
  solo(uid: string | undefined): void;
}

export interface FilmStrip {
  set(state: ChainState): void;
  /** The image after each step (by uid), and the original; frames without one stay empty. */
  setThumbnails(original: ImageData | undefined, byUid: ReadonlyMap<string, ImageData>): void;
  setSolo(uid: string | undefined): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

function button(label: string, action: string, title: string, className?: string): HTMLButtonElement {
  const b = Object.assign(el('button', className, label), { type: 'button', title });
  b.dataset.action = action;
  b.setAttribute('aria-label', title);
  return b;
}

function paint(canvas: HTMLCanvasElement, image: ImageData | undefined): void {
  if (!image) {
    delete canvas.dataset.ready;
    return;
  }
  [canvas.width, canvas.height] = [image.width, image.height];
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  canvas.dataset.ready = '';
}

/**
 * The chain as a strip of frames, one per step, each showing the picture after that step: the
 * original first, then the selection, the steps in order and an add button. A view over
 * `ChainState`; every edit goes through the handlers.
 */
export function createFilmStrip(root: HTMLElement, filters: readonly Filter<any>[], handlers: FilmStripHandlers): FilmStrip {
  const byId = new Map(filters.map((f) => [f.id, f]));
  let state: ChainState = { steps: [], selected: undefined };
  let original: ImageData | undefined;
  let thumbs: ReadonlyMap<string, ImageData> = new Map();
  let soloUid: string | undefined;
  let dragFrom = -1;

  root.replaceChildren();
  root.classList.add('film-strip');
  const originalFrame = el('div', 'frame frame-original');
  originalFrame.dataset.original = '';
  const originalCanvas = el('canvas');
  originalFrame.append(originalCanvas, el('span', 'frame-name', 'Original'));

  const selectionFrame = el('div', 'frame frame-selection');
  selectionFrame.dataset.selection = '';
  const selectionButton = button('Selection', 'select', 'Choose the area effects act on', 'step-title');
  selectionButton.addEventListener('click', () => handlers.select(SELECTION));
  const selectionSummary = el('small');
  selectionFrame.append(selectionButton, selectionSummary);

  const list = el('ol', 'strip-list');
  list.setAttribute('aria-label', 'Steps');
  const empty = el('p', 'strip-empty', 'Add an effect to start a chain: press Ctrl+K or the plus button.');
  const addFrame = el('div', 'frame frame-add');
  const add = button('+', 'add', 'Add an effect (Ctrl+K)');
  addFrame.append(add, el('span', 'frame-name', 'Add effect'));
  add.addEventListener('click', () => handlers.add());
  root.append(originalFrame, selectionFrame, list, addFrame);

  const frameAt = (i: number) => list.children[i] as HTMLElement | undefined;
  /** Where a drop at clientX lands: before or after the frame it is over. */
  const dropIndex = (over: number, clientX: number): number => {
    const r = frameAt(over)!.getBoundingClientRect();
    const after = clientX > r.left + r.width / 2;
    let to = over + (after ? 1 : 0);
    if (dragFrom < to) to -= 1; // the dragged step leaves its place first
    return to;
  };
  const clearMarks = () => list.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));

  /** Marks the pressed "up to here" button, and dims the frames after it. */
  function markSolo(): void {
    let beyond = false;
    list.querySelectorAll<HTMLElement>('li[data-step]').forEach((f) => {
      f.querySelector('[data-action=solo]')!.setAttribute('aria-pressed', String(f.dataset.step === soloUid));
      f.classList.toggle('beyond', beyond);
      if (f.dataset.step === soloUid) beyond = true;
    });
  }

  function draw(): void {
    list.replaceChildren();
    state.steps.forEach((step, i) => {
      const filter = byId.get(step.filterId)!;
      const frame = el('li', 'frame');
      frame.dataset.step = step.uid;
      frame.draggable = true;
      frame.classList.toggle('selected', step.uid === state.selected);
      frame.classList.toggle('disabled', !step.enabled);

      const canvas = el('canvas');
      paint(canvas, thumbs.get(step.uid));
      canvas.addEventListener('click', () => handlers.select(step.uid));

      const toggle = Object.assign(el('input'), { type: 'checkbox', checked: step.enabled, title: 'Enabled' });
      toggle.dataset.action = 'toggle';
      toggle.setAttribute('aria-label', `Enable ${filter.label}`);
      toggle.addEventListener('change', () => handlers.toggle(step.uid, toggle.checked));
      const title = button(filter.label, 'select', `Edit ${filter.label}`, 'step-title');
      title.textContent = filter.label;
      title.addEventListener('click', () => handlers.select(step.uid));
      title.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const to = i + (e.key === 'ArrowLeft' ? -1 : 1);
        if (to < 0 || to >= state.steps.length) return;
        handlers.move(i, to);
        // The frame is rebuilt: keep the keyboard on the step that moved.
        queueMicrotask(() => (frameAt(to)?.querySelector('.step-title') as HTMLElement | null)?.focus());
      });
      const solo = button('◐', 'solo', `Show the photo up to ${filter.label}`, 'frame-tool');
      solo.setAttribute('aria-pressed', String(soloUid === step.uid));
      solo.addEventListener('click', () => handlers.solo(soloUid === step.uid ? undefined : step.uid));
      const remove = button('✕', 'remove', `Remove ${filter.label}`, 'frame-tool');
      remove.addEventListener('click', () => handlers.remove(step.uid));

      frame.append(canvas, el('div', 'frame-bar'), el('div', 'frame-tools'));
      frame.children[1]!.append(toggle, title);
      frame.children[2]!.append(solo, remove);

      frame.addEventListener('dragstart', (e) => {
        dragFrom = i;
        e.dataTransfer?.setData('text/plain', step.uid);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        frame.classList.add('dragging');
      });
      frame.addEventListener('dragover', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        clearMarks();
        const r = frame.getBoundingClientRect();
        frame.classList.add(e.clientX > r.left + r.width / 2 ? 'drop-after' : 'drop-before');
      });
      frame.addEventListener('drop', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const from = dragFrom;
        const to = dropIndex(i, e.clientX);
        dragFrom = -1;
        clearMarks();
        if (to !== from) handlers.move(from, to);
      });
      frame.addEventListener('dragend', () => {
        dragFrom = -1;
        clearMarks();
        frame.classList.remove('dragging');
      });
      list.append(frame);
    });
    markSolo();
    empty.hidden = state.steps.length > 0;
    if (!empty.isConnected) root.append(empty);
    selectionFrame.classList.toggle('selected', state.selected === SELECTION);
    selectionSummary.textContent = state.selection ? 'set' : 'whole image';
  }

  return {
    set(next) {
      state = next;
      draw();
    },
    setThumbnails(o, byUid) {
      original = o;
      thumbs = byUid;
      paint(originalCanvas, original);
      state.steps.forEach((step, i) => {
        const c = frameAt(i)?.querySelector('canvas');
        if (c) paint(c, byUid.get(step.uid));
      });
    },
    setSolo(uid) {
      soloUid = uid;
      markSolo();
    },
  };
}
