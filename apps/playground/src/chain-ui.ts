import { defaultParams, type Filter, type Mask, type ParamSchema } from '@rullino/core';
import { renderControls } from './controls';
import { emptyBrush, renderMaskControls } from './mask-ui';

// The filter chain editor: a list of steps (enable, reorder, remove), an "add filter" menu, and
// the generated controls of the selected step. Structural edits rebuild the list; param edits
// only update state, so a slider drag in progress is never interrupted.

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

/** A named group of steps added in one go (a look). */
export interface StepGroup {
  readonly id: string;
  readonly label: string;
  steps(): readonly { readonly filter: Filter<any>; readonly params?: Readonly<Record<string, unknown>> }[];
}

const CATEGORY_LABELS: Record<string, string> = { adjust: 'Adjust', look: 'Look', classic: 'Classic', stylize: 'Stylize' };

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
  groups: readonly StepGroup[] = [],
  actions: ChainActions = {},
): ChainUi {
  let state = initial;
  const byId = new Map(filters.map((f) => [f.id, f]));

  const commit = (next: ChainState, rebuild: boolean) => {
    state = next;
    if (rebuild) draw();
    onChange(state);
  };
  const update = (uid: string, patch: Partial<StepState>) =>
    state.steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s));
  const move = (i: number, by: number) => {
    const steps = [...state.steps];
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j]!, steps[i]!];
    commit({ ...state, steps }, true);
  };

  /** The "Selection" entry above the steps: one shared area that steps can opt into. */
  function selectionEntry(): HTMLElement {
    const entry = document.createElement('div');
    entry.className = 'selection-entry';
    entry.dataset.selection = '';
    entry.classList.toggle('selected', state.selected === SELECTION);
    const header = document.createElement('div');
    header.className = 'step-header';
    const title = button('Selection', 'select', 'Choose the area filters act on');
    title.className = 'step-title';
    title.addEventListener('click', () => commit({ ...state, selected: SELECTION }, true));
    const summary = Object.assign(document.createElement('span'), { className: 'selection-summary', textContent: state.selection ? 'set' : 'whole image' });
    header.append(title, summary);
    entry.append(header);
    if (state.selected === SELECTION) {
      const body = document.createElement('div');
      body.className = 'step-body';
      body.append(
        Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Select an area once, then tick "Only in selection" on any filter.' }),
      );
      const controls = document.createElement('div');
      controls.className = 'mask-controls';
      renderMaskControls(
        controls,
        () => state.selection,
        (selection) => {
          summary.textContent = selection ? 'set' : 'whole image';
          commit(withSelection(state, selection), false);
        },
        false,
      );
      body.append(controls);
      entry.append(body);
    }
    return entry;
  }

  function draw() {
    root.replaceChildren();
    root.append(selectionEntry());
    const list = document.createElement('ol');
    list.className = 'chain';
    if (state.steps.length === 0) {
      root.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Add a filter to start a chain.' }));
    }
    state.steps.forEach((step, i) => {
      const filter = byId.get(step.filterId)!;
      const item = document.createElement('li');
      item.dataset.step = step.uid;
      item.classList.toggle('selected', step.uid === state.selected);
      item.classList.toggle('disabled', !step.enabled);

      const header = document.createElement('div');
      header.className = 'step-header';
      const toggle = Object.assign(document.createElement('input'), { type: 'checkbox', checked: step.enabled, title: 'Enabled' });
      toggle.dataset.action = 'toggle';
      toggle.setAttribute('aria-label', `Enable ${filter.label}`);
      toggle.addEventListener('change', () => commit({ ...state, steps: update(step.uid, { enabled: toggle.checked }) }, true));
      const title = button(filter.label, 'select', `Edit ${filter.label}`);
      title.className = 'step-title';
      title.addEventListener('click', () => commit({ ...state, selected: step.uid }, true));
      const up = button('↑', 'up', 'Move up');
      up.disabled = i === 0;
      up.addEventListener('click', () => move(i, -1));
      const down = button('↓', 'down', 'Move down');
      down.disabled = i === state.steps.length - 1;
      down.addEventListener('click', () => move(i, 1));
      const remove = button('✕', 'remove', 'Remove');
      remove.addEventListener('click', () =>
        commit(
          {
            ...state,
            steps: state.steps.filter((s) => s.uid !== step.uid),
            selected: state.selected === step.uid ? state.steps[i - 1]?.uid ?? state.steps[i + 1]?.uid : state.selected,
          },
          true,
        ),
      );
      header.append(toggle, title, up, down, remove);
      item.append(header);

      if (step.uid === state.selected) {
        const body = document.createElement('div');
        body.className = 'step-body';
        if (filter.description) body.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: filter.description }));
        if (filter.tryThis) body.append(Object.assign(document.createElement('p'), { className: 'try-this', textContent: `Try this: ${filter.tryThis}` }));
        const controls = document.createElement('div');
        controls.className = 'controls';
        renderControls(controls, filter.params, step.params as never, (params) =>
          commit({ ...state, steps: update(step.uid, { params }) }, false),
        );
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
        item.append(body);
      }
      list.append(item);
    });
    root.append(list);

    const add = document.createElement('select');
    add.dataset.action = 'add';
    add.setAttribute('aria-label', 'Add filter');
    add.append(new Option('+ Add filter…', ''));
    for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
      const group = Object.assign(document.createElement('optgroup'), { label });
      for (const f of filters.filter((f) => f.category === category)) group.append(new Option(f.label, f.id));
      if (group.children.length) add.append(group);
    }
    add.addEventListener('change', () => {
      const f = byId.get(add.value);
      if (!f) return;
      const step = newStep(f);
      // A patch is made from the original image, so it goes first (adjustments after it apply to the result).
      commit({ ...state, steps: f.id === 'patch' ? [step, ...state.steps] : [...state.steps, step], selected: step.uid }, true);
    });
    root.append(add);

    if (groups.length === 0) return;
    const addGroup = document.createElement('select');
    addGroup.dataset.action = 'add-look';
    addGroup.setAttribute('aria-label', 'Add look');
    addGroup.append(new Option('+ Add look…', ''), ...groups.map((g) => new Option(g.label, g.id)));
    addGroup.addEventListener('change', () => {
      const group = groups.find((g) => g.id === addGroup.value);
      if (!group) return;
      const added = group.steps().map((s) => ({ ...newStep(s.filter), params: { ...defaultParams(s.filter.params), ...s.params } }));
      commit({ ...state, steps: [...state.steps, ...added], selected: added[0]?.uid ?? state.selected }, true);
    });
    root.append(addGroup);
  }

  draw();
  return {
    set(next, redraw) {
      state = next;
      if (redraw) draw();
    },
  };
}
