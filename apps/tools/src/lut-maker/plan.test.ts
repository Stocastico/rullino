import { applyLutCpu, createImage, linearToSrgb, parseCube, runChainCpu, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { cubeFile, DEFAULT_GRADE, gradeSteps, previewEdit, type Grade } from './plan';

const grade = (g: Partial<Grade>): Grade => ({ ...DEFAULT_GRADE, ...g });

describe('gradeSteps', () => {
  it('is no steps at all for the default grade', () => {
    expect(gradeSteps(DEFAULT_GRADE)).toEqual([]);
  });

  it('a look first (its colour part only: no vignette, no grain), then the adjustments that are not at zero', () => {
    const steps = gradeSteps(grade({ look: 'fade', intensity: 0.5, exposure: 0.3, saturation: -0.2, temperature: 0.1 }));
    expect(steps.map((s) => s.filter.id)).toEqual(['applyLut', 'exposure', 'saturation', 'whiteBalance']);
    expect(steps[0]!.params).toMatchObject({ intensity: 0.5 });
    expect(steps.every((s) => s.filter.kind === 'pointwise' || s.filter.perPixel)).toBe(true);
    expect(steps[1]!.params).toEqual({ ev: 0.3 });
  });

  it('refuses an unknown look', () => {
    expect(() => gradeSteps(grade({ look: 'nope' }))).toThrow(/unknown look "nope"/);
  });
});

describe('cubeFile', () => {
  it('is a .cube of the grade that reads back to the same colours (within the LUT’s interpolation)', () => {
    const g = grade({ exposure: 0.4, contrast: 0.3, saturation: -0.5, temperature: 0.2 });
    const text = cubeFile(g, { size: 17, title: 'My "grade"' });
    expect(text).toMatch(/^TITLE "My 'grade'"\nLUT_3D_SIZE 17\n/);
    const lut = parseCube(text);
    expect(lut.size).toBe(17);
    // On grid points the LUT is the grade exactly (to the six decimals of the file).
    const colours = [[0.5, 0.5, 0.5], [1, 0, 0], [0, 0.25, 1]];
    const img = createImage(3, 1, new Float32Array(colours.flatMap((c) => [...c.map(srgbToLinear), 1])));
    const live = runChainCpu(gradeSteps(g), img);
    colours.forEach(([r, gr, b], i) => {
      const baked = applyLutCpu(lut, r!, gr!, b!);
      for (let c = 0; c < 3; c++) expect(Math.abs(baked[c]! - Math.min(1, Math.max(0, linearToSrgb(live.data[i * 4 + c]!))))).toBeLessThan(1e-5);
    });
  });

  it('a grade with saturation at −1 makes greys', () => {
    const lut = parseCube(cubeFile(grade({ saturation: -1 }), { size: 9 }));
    for (let i = 0; i < lut.data.length; i += 3) {
      expect(Math.abs(lut.data[i]! - lut.data[i + 1]!)).toBeLessThan(1e-3);
      expect(Math.abs(lut.data[i + 1]! - lut.data[i + 2]!)).toBeLessThan(1e-3);
    }
  });
});

describe('previewEdit', () => {
  it('renders the baked LUT itself (what the file will do), by a reference the renderer resolves', () => {
    expect(previewEdit('lut-maker:current')).toEqual({ version: 2, steps: [{ filter: 'applyLut', params: { look: { ref: 'lut-maker:current' } } }] });
  });
});

describe('cubeName', () => {
  it('makes a file name from the title, letters and digits kept', async () => {
    const { cubeName } = await import('./plan');
    expect(cubeName('Warm evening 2')).toBe('warm-evening-2.cube');
    expect(cubeName('  Café / noir! ')).toBe('café-noir.cube');
    expect(cubeName('')).toBe('grade.cube');
  });
});
