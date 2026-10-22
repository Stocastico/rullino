import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import type { Filter } from './filter';
import { IDENTITY_GEOMETRY, type Geometry } from './geometry';
import { identityLut } from './lut';
import { createRasterMask } from './mask';
import type { Step } from './pipeline/chain';
import { parseChain, serializeChain } from './serialize';

const gain = defineFilter({
  id: 'gain',
  label: 'Gain',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    amount: { type: 'float', min: 0, max: 4, step: 0.1, default: 1, label: 'Amount' },
    mode: { type: 'enum', options: { soft: 'Soft', hard: 'Hard' }, default: 'soft', label: 'Mode' },
    curve: { type: 'curve', default: [[0, 0], [1, 1]], label: 'Curve' },
  },
  wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return c; }',
  pixel: (c) => c,
  tolerance: { abs: 0, rel: 0 },
});
// Serialisation only looks at a filter's id and schema; a LUT filter must be multipass to be defined.
const lutFilter = { id: 'lutty', label: 'LUT', kind: 'multipass', params: { lut: { type: 'lut', default: identityLut(), label: 'LUT' } } } as unknown as Filter<any>;
const filters = [gain, lutFilter];

/** JSON round trip, as through a URL or a file. */
const viaJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('serializeChain / parseChain', () => {
  it('round-trips params, enabled flags and vector masks through JSON', () => {
    const steps: Step[] = [
      { filter: gain, params: { amount: 2.5, mode: 'hard', curve: [[0, 0.1], [0.5, 0.6], [1, 1]] } },
      { filter: gain, params: {}, enabled: false, mask: { kind: 'radial', center: [0.3, 0.4], radius: [0.2, 0.1], feather: 0.5, invert: true } },
      { filter: gain, mask: { kind: 'linear', from: [0, 0], to: [1, 0.5], opacity: 0.7 } },
    ];
    const back = parseChain(viaJson(serializeChain(steps)), { filters });
    expect(back.geometry).toBeUndefined();
    expect(back.steps.map((s) => s.filter)).toEqual([gain, gain, gain]);
    expect(back.steps[0]!.params).toEqual({ amount: 2.5, mode: 'hard', curve: [[0, 0.1], [0.5, 0.6], [1, 1]] });
    expect(back.steps[1]!.enabled).toBe(false);
    expect(back.steps[0]!.enabled).toBe(true);
    expect(back.steps[1]!.mask).toEqual(steps[1]!.mask);
    expect(back.steps[2]!.mask).toEqual(steps[2]!.mask);
  });

  it('stores only params that differ from the defaults (short links)', () => {
    const doc = serializeChain([{ filter: gain, params: { amount: 1, mode: 'hard' } }]);
    expect(doc.steps[0]!.params).toEqual({ mode: 'hard' });
  });

  it('round-trips the geometry', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, rotate: 90, flipH: true, straighten: -3.5, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }, perspective: [[0, 0], [1, 0.1], [0.9, 1], [0, 1]] };
    expect(parseChain(viaJson(serializeChain([], { geometry: g })), { filters }).geometry).toEqual(g);
  });

  it('round-trips raster masks at 8-bit precision', () => {
    const data = new Float32Array([0, 0.25, 0.5, 1, 0.1, 0.9]);
    const steps: Step[] = [{ filter: gain, mask: { kind: 'raster', raster: createRasterMask(3, 2, data), opacity: 0.5 } }];
    const mask = parseChain(viaJson(serializeChain(steps)), { filters }).steps[0]!.mask!;
    if (mask.kind !== 'raster') throw new Error('expected a raster mask');
    expect([mask.raster.width, mask.raster.height, mask.opacity]).toEqual([3, 2, 0.5]);
    for (let i = 0; i < data.length; i++) expect(Math.abs(mask.raster.data[i]! - data[i]!)).toBeLessThanOrEqual(0.5 / 255 + 1e-7);
  });

  it('stores LUTs by reference only', () => {
    const lut = identityLut(3);
    const doc = serializeChain([{ filter: lutFilter, params: { lut } }], { lutRef: (l) => (l === lut ? 'look:test' : undefined) });
    expect(viaJson(doc).steps[0]!.params).toEqual({ lut: { ref: 'look:test' } });
    const back = parseChain(viaJson(doc), { filters, resolveLut: (ref) => (ref === 'look:test' ? lut : undefined) });
    expect(back.steps[0]!.params!.lut).toBe(lut);
  });

  it('refuses a LUT it cannot reference, and a reference it cannot resolve', () => {
    expect(() => serializeChain([{ filter: lutFilter, params: { lut: identityLut(3) } }])).toThrow(/LUT/);
    const doc = viaJson(serializeChain([{ filter: lutFilter, params: { lut: identityLut(3) } }], { lutRef: () => 'look:gone' }));
    expect(() => parseChain(doc, { filters })).toThrow(/look:gone/);
  });

  it('a default LUT needs no reference', () => {
    const doc = serializeChain([{ filter: lutFilter }]);
    expect(parseChain(viaJson(doc), { filters }).steps[0]!.params).toEqual({});
  });

  it('rejects unknown filters, versions and invalid values with a useful message', () => {
    expect(() => parseChain({ version: 1, steps: [{ filter: 'nope', params: {} }] }, { filters })).toThrow(/nope/);
    expect(() => parseChain({ version: 2, steps: [] }, { filters })).toThrow(/version/);
    expect(() => parseChain({ version: 1, steps: [{ filter: 'gain', params: { amount: 'x' } }] }, { filters })).toThrow(/amount/);
    expect(() => parseChain({ version: 1, steps: [{ filter: 'gain', params: { bogus: 1 } }] }, { filters })).toThrow(/bogus/);
    expect(() => parseChain({ version: 1, steps: [{ filter: 'gain', params: {}, mask: { kind: 'radial', center: [0, 0], radius: [0, 1], feather: 0 } }] }, { filters })).toThrow(/radius/);
    expect(() => parseChain({ version: 1, steps: [], geometry: { ...IDENTITY_GEOMETRY, straighten: 90 } }, { filters })).toThrow(/straighten/);
    expect(() => parseChain('garbage', { filters })).toThrow();
  });
});
