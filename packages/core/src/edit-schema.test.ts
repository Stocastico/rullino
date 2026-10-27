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
      { geometry: { ...IDENTITY_GEOMETRY, perspective: [[0, 0], [1, 0], [1, 1], [0, 1]] }, output: { format: 'png', bitDepth: 16, longSide: 4000 } },
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
      { version: 2, steps: [], extra: true },
      { version: 2, steps: [{ filter: 'gain', params: {}, mask: { kind: 'blob' } }] },
      { version: 2, steps: [], geometry: { rotate: 45, flipH: false, flipV: false, straighten: 0, crop: { x: 0, y: 0, width: 1, height: 1 } } },
    ];
    for (const doc of bad) expect(validate(doc), JSON.stringify(doc)).toBe(false);
  });
});
