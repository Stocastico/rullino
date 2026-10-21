import type { CurvePoints, Lut, Step } from '@rullino/core';
import { applyLut, contrast, curves, grain, grayscale, saturation, vibrance, vignette, whiteBalance } from '@rullino/filters';
import { bakeLut } from './bake';

// Looks are data (PLAN §2.1): a colour grade written as ordinary pointwise adjustments, baked once
// into a 3D LUT, plus optional vignette and grain. The recipes are our own approximations of
// familiar styles, not reproductions of any app's filters.

export interface Look {
  /** camelCase, stable: used in URLs and snapshots. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Pointwise steps baked into the look's LUT. */
  readonly grade: readonly Step[];
  readonly vignette?: { readonly amount: number; readonly midpoint?: number; readonly feather?: number; readonly roundness?: number };
  readonly grain?: { readonly amount: number; readonly size?: number };
}

export interface LookOptions {
  /** 0 = no effect, 1 = the look as designed. Scales the LUT blend, vignette and grain together. */
  readonly intensity?: number;
  /** Include the look's vignette / grain steps (default true). */
  readonly vignette?: boolean;
  readonly grain?: boolean;
}

const curve = (...points: [number, number][]): CurvePoints => points;
const S_CURVE = curve([0, 0], [0.25, 0.19], [0.75, 0.84], [1, 1]);

export const looks: readonly Look[] = [
  {
    id: 'warm',
    label: 'Warm',
    description: 'Golden-hour warmth with a little extra colour.',
    grade: [
      { filter: whiteBalance, params: { temperature: 0.35, tint: 0.05 } },
      { filter: vibrance, params: { amount: 0.15 } },
    ],
    vignette: { amount: -0.2 },
  },
  {
    id: 'cool',
    label: 'Cool',
    description: 'Crisp blue cast, slightly muted.',
    grade: [
      { filter: whiteBalance, params: { temperature: -0.35 } },
      { filter: saturation, params: { amount: -0.1 } },
      { filter: contrast, params: { amount: 0.1 } },
    ],
  },
  {
    id: 'fade',
    label: 'Fade',
    description: 'Lifted blacks, softened whites and washed-out colour.',
    grade: [
      { filter: curves, params: { rgb: curve([0, 0.12], [0.5, 0.52], [1, 0.92]) } },
      { filter: saturation, params: { amount: -0.25 } },
    ],
    grain: { amount: 0.15 },
  },
  {
    id: 'noir',
    label: 'Noir',
    description: 'High-contrast black and white in the spirit of classic Ilford stock.',
    grade: [
      { filter: grayscale },
      { filter: contrast, params: { amount: 0.35 } },
      { filter: curves, params: { rgb: S_CURVE } },
    ],
    vignette: { amount: -0.35 },
    grain: { amount: 0.35 },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    description: 'Brown-toned monochrome with gentle highlights.',
    grade: [
      { filter: grayscale },
      {
        filter: curves,
        params: {
          red: curve([0, 0.05], [0.5, 0.6], [1, 1]),
          green: curve([0, 0.02], [0.5, 0.52], [1, 0.97]),
          blue: curve([0, 0], [0.5, 0.38], [1, 0.85]),
        },
      },
    ],
    vignette: { amount: -0.3 },
    grain: { amount: 0.2 },
  },
  {
    id: 'crossProcess',
    label: 'Cross process',
    description: 'Slide film in negative chemistry: punchy reds and greens, yellow highlights, blue shadows.',
    grade: [
      {
        filter: curves,
        params: {
          red: curve([0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]),
          green: curve([0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]),
          blue: curve([0, 0.15], [1, 0.8]),
        },
      },
      { filter: saturation, params: { amount: 0.15 } },
      { filter: contrast, params: { amount: 0.1 } },
    ],
  },
  {
    id: 'tealOrange',
    label: 'Teal & orange',
    description: 'Blockbuster split toning: teal shadows, warm highlights and skin.',
    grade: [
      {
        filter: curves,
        params: {
          red: curve([0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]),
          green: curve([0, 0.03], [0.5, 0.5], [1, 0.98]),
          blue: curve([0, 0.08], [0.25, 0.3], [0.75, 0.7], [1, 0.92]),
        },
      },
      { filter: vibrance, params: { amount: 0.25 } },
      { filter: contrast, params: { amount: 0.15 } },
    ],
  },
  {
    id: 'vivid',
    label: 'Vivid',
    description: 'More contrast and richer colour without blowing out skin tones.',
    grade: [
      { filter: contrast, params: { amount: 0.25 } },
      { filter: vibrance, params: { amount: 0.45 } },
      { filter: saturation, params: { amount: 0.1 } },
    ],
    vignette: { amount: -0.15 },
  },
  {
    id: 'matte',
    label: 'Matte',
    description: 'Flat, editorial finish: soft blacks, muted colour.',
    grade: [
      { filter: curves, params: { rgb: curve([0, 0.08], [0.25, 0.24], [0.75, 0.78], [1, 0.95]) } },
      { filter: saturation, params: { amount: -0.15 } },
    ],
    grain: { amount: 0.1 },
  },
  {
    id: 'golden',
    label: 'Golden',
    description: 'Vintage print: warm, faded, yellowed highlights, dark corners.',
    grade: [
      { filter: whiteBalance, params: { temperature: 0.25 } },
      {
        filter: curves,
        params: {
          rgb: curve([0, 0.06], [1, 0.97]),
          red: curve([0, 0.02], [0.5, 0.53], [1, 1]),
          blue: curve([0, 0], [0.5, 0.44], [1, 0.88]),
        },
      },
      { filter: saturation, params: { amount: -0.1 } },
    ],
    vignette: { amount: -0.35 },
    grain: { amount: 0.25 },
  },
];

const baked = new WeakMap<Look, Lut>();

/** The look's grade as a 33³ LUT, baked on first use and then always the same object. */
export function lookLut(look: Look): Lut {
  let lut = baked.get(look);
  if (!lut) baked.set(look, (lut = bakeLut(look.grade, { title: look.label })));
  return lut;
}

/** The chain steps that apply a look: its LUT, then vignette and grain if it has them. */
export function lookSteps(look: Look, options: LookOptions = {}): Step[] {
  const t = Math.min(1, Math.max(0, options.intensity ?? 1));
  const steps: Step[] = [{ filter: applyLut, params: { look: lookLut(look), intensity: t } }];
  if (look.vignette && options.vignette !== false) steps.push({ filter: vignette, params: { ...look.vignette, amount: look.vignette.amount * t } });
  if (look.grain && options.grain !== false) steps.push({ filter: grain, params: { ...look.grain, amount: look.grain.amount * t } });
  return steps;
}
