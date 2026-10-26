import type { Filter } from '@rullino/core';

export const CATEGORY_LABELS: Record<string, string> = { adjust: 'Adjust', look: 'Look', classic: 'Classic', stylize: 'Stylize' };

type Searchable = Pick<Filter<any>, 'id' | 'label' | 'category' | 'description' | 'tryThis'>;

/**
 * The effects that match every word of `query` (in their name, id, category, description or
 * suggestion), best first: a name starting with the word, then a name containing it, then the rest.
 * An empty query returns everything in the given order.
 */
export function searchEffects<T extends Searchable>(effects: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...effects];
  const scored: { effect: T; score: number; index: number }[] = [];
  effects.forEach((effect, index) => {
    const label = effect.label.toLowerCase();
    const id = effect.id.toLowerCase();
    const rest = `${CATEGORY_LABELS[effect.category] ?? effect.category} ${effect.description ?? ''} ${effect.tryThis ?? ''}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      const s = label.startsWith(w) ? 4 : label.includes(w) ? 3 : id.includes(w) ? 2 : rest.includes(w) ? 1 : 0;
      if (s === 0) return;
      score += s;
    }
    scored.push({ effect, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.effect);
}
