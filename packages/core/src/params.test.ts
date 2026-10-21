import { describe, expect, expectTypeOf, it } from 'vitest';
import { defaultParams, packParams, paramsStructWgsl, resolveParams, validateSchema, type ParamValues } from './params';

const schema = {
  amount: { type: 'float', min: -1, max: 1, step: 0.01, default: 0.25 },
  levels: { type: 'int', min: 2, max: 32, default: 4 },
  invert: { type: 'bool', default: false },
  method: { type: 'enum', options: { rec709: 'Rec. 709', average: 'Average', max: 'Max' }, default: 'average' },
} as const;

describe('parameter schema', () => {
  it('infers value types', () => {
    expectTypeOf<ParamValues<typeof schema>>().toEqualTypeOf<{
      readonly amount: number;
      readonly levels: number;
      readonly invert: boolean;
      readonly method: 'rec709' | 'average' | 'max';
    }>();
  });

  it('builds defaults', () => {
    expect(defaultParams(schema)).toEqual({ amount: 0.25, levels: 4, invert: false, method: 'average' });
  });

  it('resolves partial values over defaults, clamping and rounding numbers', () => {
    expect(resolveParams(schema, { amount: 7, levels: 3.6 })).toEqual({
      amount: 1,
      levels: 4,
      invert: false,
      method: 'average',
    });
    expect(resolveParams(schema, { levels: -10 }).levels).toBe(2);
  });

  it('rejects unknown keys, wrong types, NaN and unknown enum values', () => {
    expect(() => resolveParams(schema, { nope: 1 } as never)).toThrow(/unknown parameter "nope"/);
    expect(() => resolveParams(schema, { amount: 'x' } as never)).toThrow(/amount/);
    expect(() => resolveParams(schema, { amount: NaN })).toThrow(/amount/);
    expect(() => resolveParams(schema, { invert: 1 } as never)).toThrow(/invert/);
    expect(() => resolveParams(schema, { method: 'median' } as never)).toThrow(/method/);
  });

  it('generates a WGSL struct with one 4-byte field per param, in order', () => {
    expect(paramsStructWgsl('Params', schema)).toBe(
      'struct Params {\n  amount: f32,\n  levels: i32,\n  invert: u32,\n  method: u32,\n}',
    );
    expect(paramsStructWgsl('Params', {})).toBe('struct Params {\n  _unused: u32,\n}');
  });

  it('packs values to match the struct, padded to 16 bytes', () => {
    const buf = packParams(schema, { amount: 0.5, levels: 7, invert: true, method: 'max' });
    expect(buf.byteLength).toBe(16);
    const view = new DataView(buf);
    expect(view.getFloat32(0, true)).toBe(0.5);
    expect(view.getInt32(4, true)).toBe(7);
    expect(view.getUint32(8, true)).toBe(1);
    expect(view.getUint32(12, true)).toBe(2);
    expect(packParams({}, {}).byteLength).toBe(16);
  });

  it('validates schemas', () => {
    expect(() => validateSchema(schema)).not.toThrow();
    expect(() => validateSchema({ x: { type: 'float', min: 0, max: 1, step: 0.1, default: 2 } })).toThrow(/default/);
    expect(() => validateSchema({ x: { type: 'float', min: 1, max: 0, step: 0.1, default: 0.5 } })).toThrow(/min/);
    expect(() => validateSchema({ x: { type: 'int', min: 0, max: 4, default: 1.5 } })).toThrow(/integer/);
    expect(() => validateSchema({ x: { type: 'enum', options: { a: 'A' }, default: 'b' } as never })).toThrow(/default/);
    expect(() => validateSchema({ x: { type: 'enum', options: {}, default: 'a' } as never })).toThrow(/option/);
    // Keys become WGSL identifiers.
    expect(() => validateSchema({ 'bad-name': { type: 'bool', default: true } })).toThrow(/identifier/);
    expect(() => validateSchema({ _x: { type: 'bool', default: true } })).toThrow(/identifier/);
  });
});
