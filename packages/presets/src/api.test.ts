import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/presets: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/presets public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([
    'bakeLut', 'lookLut', 'lookSteps', 'looks',
    ]);
  });
});
