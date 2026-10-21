import { defaultParams, type Filter } from '@rullino/core';
import { renderControls } from './controls';

// The filter chain editor: a list of steps (enable, reorder, remove), an "add filter" menu, and
// the generated controls of the selected step. Structural edits rebuild the list; param edits
// only update state, so a slider drag in progress is never interrupted.

export interface StepState {
  readonly uid: string;
  readonly filterId: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
}

export interface ChainState {
  readonly steps: readonly StepState[];
  readonly selected: string | undefined;
}

let nextUid = 0;
export const newStep = (f: Filter<any>): StepState => ({
  uid: `step${++nextUid}`,
  filterId: f.id,
  params: defaultParams(f.params),
  enabled: true,
});

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
): void {
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

  function draw() {
    root.replaceChildren();
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
        const controls = document.createElement('div');
        controls.className = 'controls';
        renderControls(controls, filter.params, step.params as never, (params) =>
          commit({ ...state, steps: update(step.uid, { params }) }, false),
        );
        body.append(controls);
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
      commit({ steps: [...state.steps, step], selected: step.uid }, true);
    });
    root.append(add);
  }

  draw();
}
