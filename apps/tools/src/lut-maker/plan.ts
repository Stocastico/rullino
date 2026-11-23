// What "LUT maker" bakes: a grade (a look's colour part and a few adjustments, all per-pixel steps)
// into a 3D LUT written as a .cube file, the format DaVinci Resolve, Premiere, OBS, Final Cut and
// phone apps read. The preview renders the baked LUT itself, so it shows what the file will do.
import { formatCube, type Step } from '@rullino/core';
import { filters } from '@rullino/filters';
import { bakeLut, looks, lookSteps } from '@rullino/presets';

export interface Grade {
  /** A built-in look's id, or '' for none. */
  readonly look: string;
  readonly intensity: number;
  readonly exposure: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly vibrance: number;
  readonly temperature: number;
  readonly tint: number;
}

export const DEFAULT_GRADE: Grade = { look: '', intensity: 1, exposure: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0 };

const filter = (id: string) => filters.find((f) => f.id === id)!;

/** The grade as chain steps: the look's colour steps (no vignette or grain: a LUT holds no position), then each adjustment that is not at zero. */
export function gradeSteps(g: Grade): Step[] {
  const steps: Step[] = [];
  if (g.look) {
    const look = looks.find((l) => l.id === g.look);
    if (!look) throw new Error(`unknown look "${g.look}"`);
    steps.push(...lookSteps(look, { intensity: g.intensity, vignette: false, grain: false }));
  }
  const add = (id: string, params: Record<string, number>) => {
    if (Object.values(params).some((v) => v !== 0)) steps.push({ filter: filter(id), params });
  };
  add('exposure', { ev: g.exposure });
  add('contrast', { amount: g.contrast });
  add('saturation', { amount: g.saturation });
  add('vibrance', { amount: g.vibrance });
  add('whiteBalance', { temperature: g.temperature, tint: g.tint });
  return steps;
}

/** The grade baked into a `size`³ LUT, as the text of a .cube file. */
export function cubeFile(g: Grade, o: { readonly size?: number; readonly title?: string } = {}): string {
  return formatCube(bakeLut(gradeSteps(g), { size: o.size ?? 33, ...(o.title !== undefined && { title: o.title }) }));
}

/** An edit document that applies the LUT the renderer resolves for `ref`: the preview of the file. */
export const previewEdit = (ref: string) => ({ version: 2 as const, steps: [{ filter: 'applyLut', params: { look: { ref } } }] });

/** A file name for the .cube from its title. */
export function cubeName(title: string): string {
  const stem = title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `${stem || 'grade'}.cube`;
}
