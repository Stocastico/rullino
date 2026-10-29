export interface StatusInfo {
  readonly backend: 'gpu' | 'cpu';
  /** Why the CPU is used (shown in brackets). */
  readonly reason?: string | undefined;
  /** The loaded image: name and size. */
  readonly image: string;
  readonly steps: number;
  readonly solo?: boolean;
  readonly preview?: boolean;
  readonly ms: number;
}

/** "370 ms" below a second, "1.23 s" from there on. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** The status line in plain words: where the last frame rendered, what it showed, how long it took. */
export function statusText(info: StatusInfo): string {
  const where = info.backend === 'gpu' ? 'On the GPU (WebGPU)' : `On the CPU (${info.reason ?? 'reference implementation'})`;
  const parts = [where, info.image, `${info.steps} step${info.steps === 1 ? '' : 's'}`];
  if (info.solo) parts.push('up to one step');
  if (info.preview) parts.push('preview');
  parts.push(formatDuration(info.ms));
  return parts.join(' · ');
}
