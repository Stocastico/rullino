import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/node: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/node public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual(['createRenderer']);
  });
});
