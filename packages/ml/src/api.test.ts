import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/ml: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/ml public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([
    'DEPTH_ANYTHING_V2_SMALL', 'DEPTH_SIDE', 'MIGAN', 'ModelIntegrityError', 'SLIMSAM_77', 'createDepthEstimator',
    'createMiganInpainter', 'createSamSegmenter', 'fetchModel', 'growMask',
    ]);
  });

  it('keeps the plumbing under the unstable "./internal" subpath', async () => {
    const internal = await import('./internal');
    expect(Object.keys(internal).sort()).toEqual([
    'SAM_INPUT', 'SAM_MASK', 'depth', 'migan', 'samInput', 'samMask',
    ]);
    const publicNames = new Set(Object.keys(api));
    for (const name of Object.keys(internal)) expect(publicNames.has(name), `${name} is public and internal`).toBe(false);
  });
});
