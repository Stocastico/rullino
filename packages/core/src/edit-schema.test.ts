import Ajv from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import { IDENTITY_GEOMETRY } from './geometry';
import { createRasterMask } from './mask';
import { serializeChain } from './serialize';

// The JSON Schema shipped as @rullino/core/edit.schema.json, for people who write or validate edit
// documents outside rullino (other languages, form generators, API gateways).
const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

const gain = defineFilter({
  id: 'gain', label: 'Gain', category: 'adjust', kind: 'pointwise', alpha: 'premultiplied',
  params: { amount: { type: 'float', min: 0, max: 4, step: 0.1, default: 1, label: 'Amount' } },
  wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return c; }', pixel: (c) => c, tolerance: { abs: 0, rel: 0 },
});

describe('edit.schema.json', () => {
  it('accepts what serializeChain writes: masks of every kind, geometry, output', () => {
    const doc = serializeChain(
      [
        { filter: gain, params: { amount: 2 } },
        { filter: gain, enabled: false, mask: { kind: 'linear', from: [0, 0], to: [1, 1] } },
        { filter: gain, mask: { kind: 'radial', center: [0.5, 0.5], radius: [0.2, 0.3], feather: 0.4, invert: true, opacity: 0.5 } },
        { filter: gain, mask: { kind: 'raster', raster: createRasterMask(2, 1, Float32Array.of(0, 1)) } },
      ],
      { geometry: { ...IDENTITY_GEOMETRY, perspective: [[0, 0], [1, 0], [1, 1], [0, 1]] }, output: { format: 'png', bitDepth: 16, longSide: 4000, metadata: { strip: ['gps', 'personal'] }, embedEdit: false, colorSpace: 'display-p3', gamut: 'map' } },
    );
    expect(validate(JSON.parse(JSON.stringify(doc))), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects documents parseChain rejects', () => {
    const bad = [
      { version: 1, steps: [] }, // migrate first
      { version: 2 },
      { version: 2, steps: [{ params: {} }] },
      { version: 2, steps: [], output: { format: 'gif' } },
      { version: 2, steps: [], output: { longSide: 0 } },
      { version: 2, steps: [], output: { format: 'jpeg', bitDepth: 16 } },
      { version: 2, steps: [], output: { metadata: 'drop' } },
      { version: 2, steps: [], output: { metadata: { strip: ['faces'] } } },
      { version: 2, steps: [], output: { embedEdit: 'yes' } },
      { version: 2, steps: [], output: { colorSpace: 'prophoto' } },
      { version: 2, steps: [], output: { format: 'jpeg', hdr: 'pq' } },
      { version: 2, steps: [], output: { format: 'png', hdr: 'gain-map' } },
      { version: 2, steps: [], output: { gamut: 'soft' } },
      { version: 2, steps: [], extra: true },
      { version: 2, steps: [{ filter: 'gain', params: {}, mask: { kind: 'blob' } }] },
      { version: 2, steps: [], geometry: { rotate: 45, flipH: false, flipV: false, straighten: 0, crop: { x: 0, y: 0, width: 1, height: 1 } } },
    ];
    for (const doc of bad) expect(validate(doc), JSON.stringify(doc)).toBe(false);
  });

  const v3 = {
    version: 3,
    inputs: { photo: {}, logo: {} },
    nodes: [
      { id: 'colour', from: 'photo', geometry: { ...IDENTITY_GEOMETRY }, steps: [{ filter: 'gain', params: { amount: 2 }, mask: { kind: 'linear', from: [0, 0], to: [1, 1] } }] },
      { id: 'mono', kind: 'chain', from: 'colour', steps: [] },
      { id: 'blend', kind: 'mix', from: ['colour', 'mono'], amount: 0.3, mask: { kind: 'radial', center: [0.5, 0.5], radius: [0.2, 0.3], feather: 0.4 } },
      { id: 'small', kind: 'resize', from: 'blend', longSide: 2048 },
      { id: 'half', kind: 'resize', from: 'logo', scale: 0.5 },
    ],
    output: { node: 'small', format: 'jpeg', quality: 0.9, metadata: 'strip' },
  };

  it('accepts version 3 graphs with every node kind', () => {
    expect(validate(v3), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [] }] }), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects version 3 documents parseEdit rejects (the shape; parseEdit also checks names, cycles and filters)', () => {
    const node = (n: Record<string, unknown>) => ({ ...v3, nodes: [n] });
    const bad = [
      { ...v3, inputs: {} },
      { ...v3, inputs: { Photo: {} } },
      { ...v3, inputs: { photo: { profile: 'srgb' } } },
      { ...v3, nodes: [] },
      node({ id: 'a', kind: 'blur', from: 'photo' }),
      node({ id: 'A', from: 'photo', steps: [] }),
      node({ id: 'a', from: 'photo' }),
      node({ id: 'a', from: ['photo'], steps: [] }),
      node({ id: 'a', kind: 'mix', from: ['photo'] }),
      node({ id: 'a', kind: 'mix', from: ['photo', 'photo'], amount: 2 }),
      node({ id: 'a', kind: 'mix', from: ['photo', 'photo'], steps: [] }),
      node({ id: 'a', kind: 'resize', from: 'photo' }),
      node({ id: 'a', kind: 'resize', from: 'photo', longSide: 10, scale: 0.5 }),
      node({ id: 'a', kind: 'resize', from: 'photo', scale: 1.5 }),
      { ...v3, output: { node: 'small', size: 3 } },
      { ...v3, steps: [] },
    ];
    for (const doc of bad) expect(validate(doc), JSON.stringify(doc)).toBe(false);
  });
});
