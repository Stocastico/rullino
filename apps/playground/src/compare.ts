// What the before side of the split shows: the original, or the picture after one step of the
// chain (so you see what the later steps changed). View state only, like "up to here".
import type { ChainState } from './chain-ui';

export interface CompareOption {
  /** A step's uid, or '' for the original. */
  readonly value: string;
  readonly label: string;
}

/** The choices of the "Compare with" menu: the original, then the picture after each step. */
export function compareOptions(state: ChainState, labelOf: (filterId: string) => string): CompareOption[] {
  return [{ value: '', label: 'Original' }, ...state.steps.map((s, i) => ({ value: s.uid, label: `After ${i + 1}. ${labelOf(s.filterId)}` }))];
}

/** The compared step if it is still in the chain, else undefined (the original). */
export function resolveCompare(state: ChainState, uid: string | undefined): string | undefined {
  return uid !== undefined && state.steps.some((s) => s.uid === uid) ? uid : undefined;
}

/** The label of the before side on the split handle. */
export function compareLabel(state: ChainState, uid: string | undefined, labelOf: (filterId: string) => string): string {
  const i = uid === undefined ? -1 : state.steps.findIndex((s) => s.uid === uid);
  return i < 0 ? 'before' : `after ${i + 1}. ${labelOf(state.steps[i]!.filterId)}`;
}

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: { readonly tagName: string; readonly type?: string; readonly isContentEditable: boolean } | null;
}

/** Input types that take typed text: the compare key must not steal a backslash from them. */
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);

/** Holding backslash shows the before side over the whole image (as in Lightroom). */
export function isCompareKey(e: KeyLike): boolean {
  if (e.key !== '\\' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target;
  if (!t) return true;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return false;
  return !(t.tagName === 'INPUT' && TEXT_INPUTS.has(t.type ?? 'text'));
}
