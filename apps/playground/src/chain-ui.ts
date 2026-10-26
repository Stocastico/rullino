import { defaultParams, type Filter, type Mask, type ParamSchema } from '@rullino/core';
import { renderControls } from './controls';
import { emptyBrush, renderMaskControls } from './mask-ui';
import { CATEGORY_LABELS } from './effect-search';

// The state of the filter chain and the inspector of its selected step (description, generated
// controls, mask). The steps themselves are shown by the film strip; edits reach it through
// `subscribe`. Structural edits redraw the inspector; param edits only update state, so a slider
// drag in progress is never interrupted.

export interface StepState {
  readonly uid: string;
  readonly filterId: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  readonly mask?: Mask;
  /** Act where the chain's selection says, instead of through the step's own `mask`. */
  readonly useSelection?: boolean;
}

/** `ChainState.selected` while the selection (not a step) is being edited. */
export const SELECTION = 'selection';

export interface ChainState {
  readonly steps: readonly StepState[];
  /** A step's uid, or SELECTION. */
  readonly selected: string | undefined;
  /** The area steps with `useSelection` act on; undefined = the whole image. */
  readonly selection?: Mask;
}

/** The mask a step is rendered with: the selection if it asks for it (and there is one), else its own. */
export function effectiveMask(state: ChainState, step: StepState): Mask | undefined {
  return step.useSelection ? state.selection : step.mask;
}

/** Things the chain editor cannot do itself. */
export interface ChainActions {
  /** Fills a patch step's image (object removal) from its mask. */
  fill?(uid: string): Promise<void>;
  /** Estimates the depth map of a lens blur step. */
  estimateDepth?(uid: string): Promise<void>;
  /** The next click on the image sets the lens blur step's focus to the depth there. */
  pickFocus?(uid: string): void;
}

export interface ChainUi {
  /** Replaces the state after an edit made elsewhere (e.g. on the image); redraws only if asked. */
  set(state: ChainState, redraw: boolean): void;
  /** Appends a step for the filter (a patch goes first) and selects it. */
  add(filter: Filter<any>): void;
  /** Selects a step by uid, or SELECTION. */
  select(uid: string): void;
  toggle(uid: string, enabled: boolean): void;
  remove(uid: string): void;
  /** Moves the step at `from` so that it ends up at index `to`. */
  move(from: number, to: number): void;
  /** Called with the new state after every change, from here or from `set`. */
  subscribe(listener: (state: ChainState) => void): void;
}

/** The step with `mask` set, or removed when undefined. */
export function withMask(step: StepState, mask: Mask | undefined): StepState {
  const { mask: _, ...rest } = step;
  return mask ? { ...rest, mask } : rest;
}

/** The state with the selection set, or removed when undefined. */
export function withSelection(state: ChainState, selection: Mask | undefined): ChainState {
  const { selection: _, ...rest } = state;
  return selection ? { ...rest, selection } : rest;
}

/** Filters that act where a mask says (inpainting) or show an image only there (patch): they always have a mask. */
const wantsMask = (f: Filter<any>) => f.kind === 'multipass' && (!!f.usesMask || f.id === 'patch');

let nextUid = 0;
/** A step with default params; filters that need a mask start with an empty brush mask to paint. */
export const newStep = (f: Filter<any>): StepState => ({
  uid: `step${++nextUid}`,
  filterId: f.id,
  params: defaultParams(f.params),
  enabled: true,
  ...(wantsMask(f) ? { mask: emptyBrush() } : {}),
});

function button(label: string, action: string, title: string): HTMLButtonElement {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title });
  b.dataset.action = action;
  b.setAttribute('aria-label', title);
  return b;
}

export function renderChain(
  root: HTMLElement,
  filters: readonly Filter<any>[],
  initial: ChainState,
  onChange: (state: ChainState) => void,
  actions: ChainActions = {},
): ChainUi {
  let state = initial;
  const byId = new Map(filters.map((f) => [f.id, f]));
  const listeners: ((state: ChainState) => void)[] = [];

  const commit = (next: ChainState, rebuild: boolean) => {
    state = next;
    if (rebuild) draw();
    listeners.forEach((l) => l(state));
    onChange(state);
  };
  const update = (uid: string, patch: Partial<StepState>) =>
    state.steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s));

  function addFilter(f: Filter<any>): void {
    const step = newStep(f);
    // A patch is made from the original image, so it goes first (adjustments after it apply to the result).
    commit({ ...state, steps: f.id === 'patch' ? [step, ...state.steps] : [...state.steps, step], selected: step.uid }, true);
  }
  function remove(uid: string): void {
    const i = state.steps.findIndex((s) => s.uid === uid);
    if (i < 0) return;
    commit({ ...state, steps: state.steps.filter((s) => s.uid !== uid), selected: state.selected === uid ? state.steps[i - 1]?.uid ?? state.steps[i + 1]?.uid : state.selected }, true);
  }
  function move(from: number, to: number): void {
    const steps = [...state.steps];
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return;
    steps.splice(to, 0, steps.splice(from, 1)[0]!);
    commit({ ...state, steps }, true);
  }

  /** The inspector of the selection: one shared area that steps can opt into. */
  function selectionInspector(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'step-body';
    body.dataset.selection = '';
    body.append(
      Object.assign(document.createElement('h3'), { className: 'inspector-title', textContent: 'Selection' }),
      Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Select an area once, then tick "Only in selection" on any effect.' }),
    );
    const controls = document.createElement('div');
    controls.className = 'mask-controls';
    renderMaskControls(controls, () => state.selection, (selection) => commit(withSelection(state, selection), false), false);
    body.append(controls);
    return body;
  }

  function stepInspector(step: StepState): HTMLElement {
    const filter = byId.get(step.filterId)!;
    const body = document.createElement('div');
    body.className = 'step-body';
    body.dataset.step = step.uid;
    const title = document.createElement('h3');
    title.className = 'inspector-title';
    title.textContent = filter.label;
    title.append(Object.assign(document.createElement('small'), { textContent: CATEGORY_LABELS[filter.category] ?? filter.category }));
    body.append(title);
    if (filter.description) body.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: filter.description }));
    if (filter.tryThis) body.append(Object.assign(document.createElement('p'), { className: 'try-this', textContent: `Try this: ${filter.tryThis}` }));
    const controls = document.createElement('div');
    controls.className = 'controls';
    renderControls(controls, filter.params, step.params as never, (params) => commit({ ...state, steps: update(step.uid, { params }) }, false));
    const maskControls = document.createElement('div');
    maskControls.className = 'mask-controls';
    body.append(controls);
    if (!wantsMask(filter)) {
      const label = document.createElement('label');
      label.className = 'use-selection';
      const check = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!step.useSelection });
      check.dataset.action = 'use-selection';
      check.addEventListener('change', () => commit({ ...state, steps: update(step.uid, { useSelection: check.checked }) }, true));
      label.append(check, ' Only in selection');
      body.append(label);
    }
    if (step.useSelection) {
      const edit = button('Edit selection', 'edit-selection', 'Change the area this step acts on');
      edit.addEventListener('click', () => commit({ ...state, selected: SELECTION }, true));
      maskControls.append(
        Object.assign(document.createElement('p'), { className: 'hint', textContent: state.selection ? 'Acts only inside the selection.' : 'Nothing is selected yet: acts on the whole image.' }),
        edit,
      );
    } else {
      // Reads the step from the current state: the mask can also change from the image overlay.
      renderMaskControls(
        maskControls,
        () => state.steps.find((s) => s.uid === step.uid)?.mask,
        (mask) => commit({ ...state, steps: state.steps.map((s) => (s.uid === step.uid ? withMask(s, mask) : s)) }, false),
        wantsMask(filter),
      );
    }
    body.append(maskControls);
    if (filter.id === 'patch' && actions.fill) {
      const fill = button('Fill with AI', 'fill', 'Fill the masked area with AI');
      fill.className = 'primary';
      fill.addEventListener('click', () => {
        fill.disabled = true;
        void actions.fill!(step.uid).finally(() => (fill.disabled = false));
      });
      body.append(fill);
    }
    if (filter.id === 'lensBlur' && actions.estimateDepth) {
      const estimate = button('Estimate depth', 'depth', 'Estimate the depth map with AI');
      estimate.className = 'primary';
      estimate.addEventListener('click', () => {
        estimate.disabled = true;
        void actions.estimateDepth!(step.uid).finally(() => (estimate.disabled = false));
      });
      const pick = button('Pick focus', 'pick-focus', 'Click the image to focus there');
      pick.disabled = step.params.depth === (filter.params as ParamSchema).depth?.default;
      pick.addEventListener('click', () => actions.pickFocus?.(step.uid));
      body.append(estimate, pick);
    }
    return body;
  }

  function draw() {
    root.replaceChildren();
    const step = state.steps.find((s) => s.uid === state.selected);
    if (state.selected === SELECTION) root.append(selectionInspector());
    else if (step) root.append(stepInspector(step));
    else root.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: state.steps.length ? 'Select a frame in the strip under the photo to edit it.' : 'Press Browse effects (Ctrl+K) to add the first effect.' }));
  }

  draw();
  return {
    set(next, redraw) {
      state = next;
      if (redraw) draw();
      listeners.forEach((l) => l(state));
    },
    add: addFilter,
    select: (uid) => commit({ ...state, selected: uid }, true),
    toggle: (uid, enabled) => commit({ ...state, steps: update(uid, { enabled }) }, false),
    remove,
    move,
    subscribe: (listener) => {
      listeners.push(listener);
      listener(state);
    },
  };
}
