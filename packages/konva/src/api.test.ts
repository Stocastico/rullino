import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/konva: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/konva public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual(['attachEdit']);
  });
});
