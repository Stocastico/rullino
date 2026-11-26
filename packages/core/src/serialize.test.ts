import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import type { Filter } from './filter';
import { IDENTITY_GEOMETRY, type Geometry } from './geometry';
import { createImage } from './image';
import { identityLut } from './lut';
import { createRasterMask } from './mask';
import type { Step } from './pipeline/chain';
import { ParseError } from './parse-error';
import { CHAIN_VERSION, migrateChain, parseChain, parseGeometry, parseMask, serializeChain, type OutputSettings } from './serialize';

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
const patchFilter = { id: 'patchy', label: 'Patch', kind: 'multipass', params: { patch: { type: 'image', default: createImage(1, 1), label: 'Patch' } } } as unknown as Filter<any>;
const filters = [gain, lutFilter, patchFilter];

/** The steps of the one chain node serializeChain writes. */
const stepsOf = (doc: { nodes: readonly unknown[] }) => (doc.nodes[0] as { steps: { params: unknown }[] }).steps;

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
    expect(stepsOf(doc)[0]!.params).toEqual({ mode: 'hard' });
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
    expect(stepsOf(viaJson(doc))[0]!.params).toEqual({ lut: { ref: 'look:test' } });
    const back = parseChain(viaJson(doc), { filters, resolveLut: (ref) => (ref === 'look:test' ? lut : undefined) });
    expect(back.steps[0]!.params!.lut).toBe(lut);
  });

  it('refuses a LUT it cannot reference, and a reference it cannot resolve', () => {
    expect(() => serializeChain([{ filter: lutFilter, params: { lut: identityLut(3) } }])).toThrow(/LUT/);
    const doc = viaJson(serializeChain([{ filter: lutFilter, params: { lut: identityLut(3) } }], { lutRef: () => 'look:gone' }));
    expect(() => parseChain(doc, { filters })).toThrow(/look:gone/);
  });

  it('refuses an image param (a patch cannot travel in a link) unless it is the default', () => {
    expect(() => serializeChain([{ filter: patchFilter, params: { patch: createImage(2, 2) } }])).toThrow(/image/);
    expect(stepsOf(serializeChain([{ filter: patchFilter }]))[0]!.params).toEqual({});
    expect(() => parseChain({ version: 1, steps: [{ filter: 'patchy', params: { patch: { width: 1 } } }] }, { filters })).toThrow(/patch/);
  });

  it('a default LUT needs no reference', () => {
    const doc = serializeChain([{ filter: lutFilter }]);
    expect(parseChain(viaJson(doc), { filters }).steps[0]!.params).toEqual({});
  });

  it('rejects unknown filters, versions and invalid values with a useful message', () => {
    expect(() => parseChain({ version: 1, steps: [{ filter: 'nope', params: {} }] }, { filters })).toThrow(/nope/);
    expect(() => parseChain({ version: 4, steps: [] }, { filters })).toThrow(/version/);
    expect(() => parseChain({ version: 1, steps: [{ filter: 'gain', params: { amount: 'x' } }] }, { filters })).toThrow(/amount/);
    expect(() => parseChain({ version: 1, steps: [{ filter: 'gain', params: { bogus: 1 } }] }, { filters })).toThrow(/bogus/);
    expect(() => parseChain({ version: 1, steps: [{ filter: 'gain', params: {}, mask: { kind: 'radial', center: [0, 0], radius: [0, 1], feather: 0 } }] }, { filters })).toThrow(/radius/);
    expect(() => parseChain({ version: 1, steps: [], geometry: { ...IDENTITY_GEOMETRY, straighten: 90 } }, { filters })).toThrow(/straighten/);
    expect(() => parseChain('garbage', { filters })).toThrow();
  });
});

describe('edit document v2', () => {
  it('writes version 3 (one input, one chain node) and round-trips the output settings', () => {
    const output: OutputSettings = { format: 'jpeg', quality: 0.85, longSide: 2048, background: [1, 0.5, 0] };
    const doc = viaJson(serializeChain([{ filter: gain, params: { amount: 2 } }], { output, geometry: IDENTITY_GEOMETRY }));
    expect(CHAIN_VERSION).toBe(2);
    expect(doc).toEqual({
      version: 3,
      inputs: { main: {} },
      nodes: [{ id: 'edit', from: 'main', steps: [{ filter: 'gain', params: { amount: 2 } }], geometry: IDENTITY_GEOMETRY }],
      output,
    });
    expect(parseChain(doc, { filters }).output).toEqual(output);
    expect(parseChain(viaJson(serializeChain([])), { filters }).output).toBeUndefined();
    expect(serializeChain([])).not.toHaveProperty('output');
  });

  it('carries the metadata policy and embedEdit (#180), and round-trips them', () => {
    for (const metadata of ['keep', 'strip', { strip: ['gps'] }, { strip: ['gps', 'personal'] }] as const) {
      const output: OutputSettings = { format: 'jpeg', metadata, embedEdit: false };
      const doc = viaJson(serializeChain([], { output }));
      expect(parseChain(doc, { filters }).output).toEqual(output);
    }
  });

  it('carries colorSpace and gamut (#181), and round-trips them', () => {
    for (const colorSpace of ['srgb', 'display-p3', 'adobe-rgb', 'rec2020'] as const)
      for (const gamut of ['map', 'clip'] as const) {
        const output: OutputSettings = { format: 'png', colorSpace, gamut };
        expect(parseChain(viaJson(serializeChain([], { output })), { filters }).output).toEqual(output);
      }
  });

  it('carries hdr: "gain-map" (#182) for JPEG, and round-trips it', () => {
    const output: OutputSettings = { format: 'jpeg', hdr: 'gain-map' };
    expect(parseChain(viaJson(serializeChain([], { output })), { filters }).output).toEqual(output);
  });

  it('rejects invalid output settings with a useful message', () => {
    const bad: [unknown, RegExp][] = [
      [{ format: 'gif' }, /format/],
      [{ quality: 1.5 }, /quality/],
      [{ bitDepth: 12 }, /bitDepth/],
      [{ format: 'jpeg', bitDepth: 16 }, /bitDepth/],
      [{ longSide: 0 }, /longSide/],
      [{ longSide: 10.5 }, /longSide/],
      [{ background: [1, 2, 0] }, /background/],
      [{ size: 3 }, /size/],
      [{ metadata: 'drop' }, /metadata/],
      [{ metadata: { strip: ['faces'] } }, /metadata/],
      [{ metadata: { strip: 'gps' } }, /metadata/],
      [{ metadata: { strip: ['gps'], also: 1 } }, /metadata/],
      [{ embedEdit: 'yes' }, /embedEdit/],
      [{ colorSpace: 'prophoto' }, /colorSpace/],
      [{ hdr: 'pq' }, /hdr/],
      [{ format: 'png', hdr: 'gain-map' }, /hdr.*jpeg/],
      [{ hdr: 'gain-map' }, /hdr.*jpeg/], // PNG is the default format
      [{ gamut: 'soft' }, /gamut/],
    ];
    for (const [output, message] of bad) {
      expect(() => parseChain({ version: 2, steps: [], output }, { filters }), JSON.stringify(output)).toThrow(message);
      expect(() => serializeChain([], { output: output as OutputSettings }), JSON.stringify(output)).toThrow(message);
    }
  });

  it('migrates a version 1 document (old share links keep working)', () => {
    const v1 = { version: 1, steps: [{ filter: 'gain', params: { amount: 2 } }], geometry: IDENTITY_GEOMETRY };
    const v2 = migrateChain(v1);
    expect(v2).toEqual({ version: 2, steps: v1.steps, geometry: IDENTITY_GEOMETRY });
    expect(v1.version).toBe(1); // the input is not mutated
    expect(migrateChain(v2)).toBe(v2); // already current
    expect(parseChain(v1, { filters }).steps[0]!.params).toEqual({ amount: 2 });
    expect(() => migrateChain({ version: 0, steps: [] })).toThrow(/version/);
    expect(() => migrateChain('{}')).toThrow(/object/);
  });

  it('reads a version 3 document that is one chain on one input, like its v2 form', () => {
    const v2 = { version: 2, geometry: { ...IDENTITY_GEOMETRY, rotate: 90 }, steps: [{ filter: 'gain', params: { amount: 2 } }], output: { format: 'jpeg', longSide: 300 } };
    const v3 = { version: 3, inputs: { photo: {} }, nodes: [{ id: 'look', from: 'photo', geometry: v2.geometry, steps: v2.steps }], output: { node: 'look', format: 'jpeg', longSide: 300 } };
    expect(parseChain(v3, { filters })).toEqual(parseChain(v2, { filters }));
  });

  it('refuses a version 3 document that is a real graph, and says what to use', () => {
    const graph = { version: 3, inputs: { photo: {} }, nodes: [{ id: 'a', from: 'photo', steps: [] }, { id: 'b', kind: 'resize', from: 'a', scale: 0.5 }] };
    expect(() => parseChain(graph, { filters })).toThrow(/parseChain: this document is a graph \(2 nodes\); use parseEdit/);
  });
});

describe('numbers in masks and geometry', () => {
  // Found by the fuzz job: Number() on an object whose toString is not a function throws a TypeError.
  const hostile = { toString: {} };
  const crop = { x: 0, y: 0, width: 1, height: 1 };
  it('a non-number feather, opacity, straighten or crop value is a ParseError, not a TypeError', () => {
    const radial = { kind: 'radial', center: [0.5, 0.5], radius: [0.3, 0.2], feather: 0.4 };
    for (const v of [hostile, '0.5', null, [0.5]]) {
      expect(() => parseMask({ ...radial, feather: v })).toThrow(ParseError);
      expect(() => parseMask({ ...radial, opacity: v })).toThrow(ParseError);
      expect(() => parseGeometry({ rotate: 0, straighten: v, crop })).toThrow(ParseError);
      for (const k of Object.keys(crop)) expect(() => parseGeometry({ rotate: 0, straighten: 0, crop: { ...crop, [k]: v } })).toThrow(ParseError);
    }
    expect(parseMask(radial)).toMatchObject({ feather: 0.4 });
  });
});
