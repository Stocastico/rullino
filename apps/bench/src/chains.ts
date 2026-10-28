// The three chains of PLAN §6b, each with two variants that differ in one parameter (the "change"
// whose latency is measured). rullino runs them exactly; the other libraries run their closest
// equivalent, described in each adapter's notes. Data only: nothing here imports a library, so each
// adapter's chunk holds its own library alone (its gzip size is measured).

export const CHAIN_IDS = ['exposure-curves-lut', 'blur-unsharp', 'levels-vignette-grain'] as const;
export type ChainId = (typeof CHAIN_IDS)[number];
export type Variant = 0 | 1;

export const CHAIN_LABELS: Record<ChainId, string> = {
  'exposure-curves-lut': 'exposure + curves + LUT',
  'blur-unsharp': 'blur + unsharp',
  'levels-vignette-grain': 'levels + vignette + grain',
};

/** The parameters every adapter maps to its own operations; only the first one changes. */
export function chainParams(chain: ChainId, variant: Variant): Record<string, number> {
  switch (chain) {
    case 'exposure-curves-lut':
      return { ev: variant ? 0.5 : 0.3 };
    case 'blur-unsharp':
      return { sigma: variant ? 3.5 : 3, amount: 0.8, sharpenSigma: 2 };
    case 'levels-vignette-grain':
      return { inBlack: variant ? 0.08 : 0.05, vignette: -0.4, grain: 0.3 };
  }
}

/** An S-curve in sRGB-encoded units, shared by every library that can apply a curve. */
export const CURVE: [number, number][] = [[0, 0], [0.3, 0.25], [0.7, 0.8], [1, 1]];
/** The look whose 33³ LUT chain 1 applies (by name, so it also travels in edit documents). */
export const LOOK_ID = 'warm';
