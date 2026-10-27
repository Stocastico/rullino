import type { Filter } from '@rullino/core';
import { createImage, identityLut } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { filters } from './index';
import { filterReference, parityTable } from './reference';

const fake = (over: Record<string, unknown>) => ({ id: 'thing', label: 'Thing', category: 'adjust', kind: 'pointwise', alpha: 'straight', params: {}, ...over }) as unknown as Filter<any>;

describe('filterReference', () => {
  it('describes every param type: range, options, unit, group and default', () => {
    const md = filterReference([
      fake({
        description: 'Does a thing.',
        tryThis: 'Drag Amount to the right.',
        params: {
          amount: { type: 'float', min: -1, max: 1, step: 0.05, default: 0.25, label: 'Amount', description: 'How much | of it.' },
          sigma: { type: 'float', min: 0.5, max: 8, step: 0.5, default: 2, unit: 'px', label: 'Sigma' },
          radius: { type: 'int', min: 1, max: 40, default: 4, unit: 'px', label: 'Radius' },
          invert: { type: 'bool', default: true, label: 'Invert' },
          mode: { type: 'enum', options: { soft: 'Soft light', hard: 'Hard light' }, default: 'hard', label: 'Mode' },
          kernel: { type: 'kernel', size: 5, default: new Array(25).fill(0), label: 'Kernel' },
          curve: { type: 'curve', default: [[0, 0], [0.5, 0.6], [1, 1]], label: 'Curve' },
          look: { type: 'lut', default: identityLut(2), label: 'LUT file' },
          depth: { type: 'image', default: createImage(1, 1), label: 'Depth map' },
          tint: { type: 'color', default: [1, 0.5, 0], label: 'Tint', group: 'Colour' },
        },
      }),
    ]);
    expect(md).toContain('### Thing (`thing`)');
    expect(md).toContain('Does a thing.');
    expect(md).toContain('**Try this:** Drag Amount to the right.');
    expect(md).toContain('| `amount` | Amount | number | −1 … 1 (step 0.05) | 0.25 |  | How much \\| of it. |');
    expect(md).toContain('| `sigma` | Sigma (px) | number | 0.5 … 8 (step 0.5), in pixels of the full-resolution image | 2 |');
    expect(md).toContain('| `radius` | Radius (px) | integer | 1 … 40, in pixels of the full-resolution image | 4 |');
    expect(md).toContain('| `invert` | Invert | on / off |  | on |');
    expect(md).toContain('| `mode` | Mode | choice | `soft` Soft light, `hard` Hard light | `hard` |');
    expect(md).toContain('| `kernel` | Kernel | 5×5 matrix | 25 values | all 0 |');
    expect(md).toContain('| `curve` | Curve | tone curve | 2 to 16 points in [0, 1] | (0, 0) (0.5, 0.6) (1, 1) |');
    expect(md).toContain('| `look` | LUT file | 3D LUT | `.cube` or HaldCLUT file | none |');
    expect(md).toContain('| `depth` | Depth map | image | an image set by the app, not serialisable | none |');
    expect(md).toContain('| `tint` | Tint | colour | sRGB colour | #ff8000 |');
  });

  it('groups by category with counts, and says what kind each filter is', () => {
    const md = filterReference([
      fake({ id: 'a', label: 'A', category: 'adjust' }),
      fake({ id: 'b', label: 'B', category: 'classic', kind: 'multipass', passes: [{ name: 'x' }, { name: 'y' }], usesMask: true }),
      fake({ id: 'c', label: 'C', category: 'adjust', alpha: 'premultiplied' }),
    ]);
    expect(md).toContain('3 filters');
    expect(md.indexOf('## Adjust (2)')).toBeLessThan(md.indexOf('## Classic (1)'));
    expect(md).toContain('Pointwise, straight alpha');
    expect(md).toContain('Pointwise, premultiplied alpha');
    expect(md).toContain('Multipass (2 passes), needs a mask');
    expect(md).not.toContain('## Look');
  });

  it('a filter without params says so', () => {
    expect(filterReference([fake({})])).toContain('No parameters.');
  });

  it('the committed reference matches the registry (run `npx vitest run packages/filters -u` after changing a filter)', async () => {
    await expect(filterReference(filters)).toMatchFileSnapshot('../../../docs/filters.md');
  });
});

describe('parityTable', () => {
  it('lists abs / rel / outliers per filter, grouped by category, with the error allowed at 1.0', () => {
    const md = parityTable([
      fake({ id: 'a', label: 'A', category: 'adjust', tolerance: { abs: 1e-7, rel: 2 ** -10 } }),
      fake({ id: 'b', label: 'B', category: 'classic', kind: 'multipass', passes: [{ name: 'x' }], tolerance: { abs: 0, rel: 0, outliers: 0.002 } }),
      fake({ id: 'c', label: 'C', category: 'stylize', kind: 'multipass', passes: [{ name: 'x' }], tolerance: { abs: 1e-2, rel: 1e-2, outliers: 0.02 } }),
    ]);
    expect(md).toContain('3 filters');
    expect(md.indexOf('## Adjust (1)')).toBeLessThan(md.indexOf('## Classic (1)'));
    expect(md).toContain('| A (`a`) | pointwise | 1e-7 | 0.000977 | 0.000977 | 0 |');
    expect(md).toContain('| B (`b`) | multipass | 0 | 0 | 0 | 0.2% |');
    expect(md).toContain('| C (`c`) | multipass | 0.01 | 0.01 | 0.02 | 2% |');
    expect(md).not.toContain('## Look');
  });

  it('the committed table matches the registry (run `npx vitest run packages/filters -u` after changing a tolerance)', async () => {
    await expect(parityTable(filters)).toMatchFileSnapshot('../../../docs/parity.md');
  });
});
