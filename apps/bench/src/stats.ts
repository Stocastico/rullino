/** Median, minimum and maximum of a timing sample, in its units. */
export interface Summary {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly runs: number;
}

export function summarise(sample: readonly number[]): Summary {
  if (sample.length === 0) throw new RangeError('no runs to summarise');
  const s = [...sample].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return { median, min: s[0]!, max: s.at(-1)!, runs: s.length };
}

/**
 * Mean absolute difference of the colour channels of two RGBA8 images, in 8-bit units (0–255),
 * alpha ignored: how far another library's closest equivalent lands from rullino's result.
 */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new RangeError(`images differ in size: ${a.length} vs ${b.length} bytes`);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  return sum / ((a.length / 4) * 3);
}
