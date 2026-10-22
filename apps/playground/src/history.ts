// Undo / redo over immutable snapshots. The caller decides when a state is worth recording
// (e.g. when a slider is released, not on every move), so one gesture is one undo step.

export interface HistoryOptions<T> {
  /** Maximum number of undo steps kept. Default 100. */
  readonly limit?: number;
  /** States that compare equal are not recorded. Default: identity. */
  readonly same?: (a: T, b: T) => boolean;
}

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private readonly limit: number;
  private readonly same: (a: T, b: T) => boolean;

  constructor(
    private present: T,
    options: HistoryOptions<T> = {},
  ) {
    this.limit = options.limit ?? 100;
    this.same = options.same ?? Object.is;
  }

  get current(): T {
    return this.present;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Makes `state` the current one, as a new undo step (unless it equals the current state). */
  record(state: T): void {
    if (this.same(this.present, state)) return;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = state;
    this.future = [];
  }

  /** Changes the current state without adding an undo step (e.g. a selection change). */
  replace(state: T): void {
    this.present = state;
  }

  undo(): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(this.present);
    return (this.present = prev);
  }

  redo(): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.present);
    return (this.present = next);
  }
}
