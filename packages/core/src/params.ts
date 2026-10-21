import { CURVE_SAMPLES, curveLut, curveSamplerWgsl, type CurvePoints } from './curve';
import { MAX_LUT_SIZE, type Lut } from './lut';

// Parameter schema: the contract between a filter, its UI, validation and serialisation.
// Scalars are one 4-byte uniform field (f32 / i32 / u32); kernels are a 16-byte aligned
// array<vec4f, N>. Fields follow declaration order with WGSL uniform layout rules.

interface ParamBase {
  readonly label?: string;
  readonly description?: string;
}

export interface FloatParam extends ParamBase {
  readonly type: 'float';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** 'px': a length in full-resolution pixels, scaled down with the image for previews. */
  readonly unit?: 'px';
}

export interface IntParam extends ParamBase {
  readonly type: 'int';
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit?: 'px';
}

/** A square convolution kernel, row-major. In WGSL: array<vec4f, ceil(size² / 4)>; read k[i / 4][i % 4]. */
export interface KernelParam extends ParamBase {
  readonly type: 'kernel';
  readonly size: 3 | 5;
  readonly default: readonly number[];
}

export interface BoolParam extends ParamBase {
  readonly type: 'bool';
  readonly default: boolean;
}

/** `options` maps value -> label. In WGSL the value is a u32: the option's index in declaration order. */
export interface EnumParam<O extends Readonly<Record<string, string>> = Readonly<Record<string, string>>>
  extends ParamBase {
  readonly type: 'enum';
  readonly options: O;
  readonly default: keyof O & string;
}

/**
 * A tone curve: 2..16 control points in [0, 1]², x strictly increasing. Sampled to a 256-entry
 * LUT (`curve.ts`); WGSL code reads it with the generated `curve_<name>(x)` sampler.
 */
export interface CurveParam extends ParamBase {
  readonly type: 'curve';
  readonly default: CurvePoints;
}

/**
 * A 3D colour LUT (`lut.ts`). Only its domain goes into the uniform block (array<vec4f, 2>: min, max);
 * the table itself is a 3D texture bound by multipass filters, read through the generated
 * `lut_<name>(rgb)` sampler. Values are kept by identity, so GPU textures can be cached per Lut object.
 */
export interface LutParam extends ParamBase {
  readonly type: 'lut';
  readonly default: Lut;
}

export type Param = FloatParam | IntParam | BoolParam | EnumParam | KernelParam | CurveParam | LutParam;
export type ParamSchema = Readonly<Record<string, Param>>;

export type ParamValue<P extends Param> = P extends { readonly type: 'float' | 'int' }
  ? number
  : P extends { readonly type: 'bool' }
    ? boolean
    : P extends { readonly type: 'enum'; readonly options: infer O }
      ? keyof O & string
      : P extends { readonly type: 'kernel' }
        ? readonly number[]
        : P extends { readonly type: 'curve' }
          ? CurvePoints
          : P extends { readonly type: 'lut' }
            ? Lut
            : never;

export type ParamValues<S extends ParamSchema> = { readonly [K in keyof S]: ParamValue<S[K]> };

const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** Why `v` is not a valid curve, or undefined if it is. */
function curveProblem(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length < 2 || v.length > 16) return 'a curve needs 2 to 16 points';
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((c) => typeof c === 'number' && Number.isFinite(c))) return 'points are [x, y] number pairs';
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return 'points must lie in [0, 1]';
  }
  for (let i = 1; i < v.length; i++) if (!(v[i][0] > v[i - 1][0])) return 'point x must be strictly increasing';
  return undefined;
}

/** Why `v` is not a usable LUT, or undefined if it is. */
function lutProblem(v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null) return 'not a LUT object';
  const l = v as Partial<Lut>;
  if (!Number.isInteger(l.size) || l.size! < 2 || l.size! > MAX_LUT_SIZE) return `size must be an integer in [2, ${MAX_LUT_SIZE}]`;
  if (!(l.data instanceof Float32Array) || l.data.length !== l.size! ** 3 * 3) return 'data must be a Float32Array of size³ RGB triples';
  const ok = (d: unknown) => Array.isArray(d) && d.length === 3 && d.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!ok(l.domainMin) || !ok(l.domainMax)) return 'domain must be two [r, g, b] number triples';
  if (!l.domainMin!.every((m, i) => l.domainMax![i]! > m)) return 'domain max must exceed min';
  return undefined;
}

export function validateSchema(schema: ParamSchema): void {
  for (const [key, p] of Object.entries(schema)) {
    const fail = (msg: string) => {
      throw new Error(`param "${key}": ${msg}`);
    };
    if (!IDENTIFIER.test(key)) fail('key must be a WGSL identifier (letter first, then letters, digits, _)');
    switch (p.type) {
      case 'float':
      case 'int':
        if (!(p.min < p.max)) fail(`min (${p.min}) must be < max (${p.max})`);
        if (!(p.default >= p.min && p.default <= p.max)) fail(`default ${p.default} outside [${p.min}, ${p.max}]`);
        if (p.type === 'int' && ![p.min, p.max, p.default].every(Number.isInteger)) fail('int bounds and default must be integers');
        if (p.type === 'float' && !(p.step > 0)) fail('step must be > 0');
        break;
      case 'bool':
        break;
      case 'enum':
        if (Object.keys(p.options).length === 0) fail('enum needs at least one option');
        // Object key order puts integer-like keys first, which would break "WGSL index = declaration order".
        if (Object.keys(p.options).some((k) => /^(0|[1-9]\d*)$/.test(k))) fail('enum option keys must not be integer-like');
        if (!Object.hasOwn(p.options, p.default)) fail(`default "${p.default}" is not an option`);
        break;
      case 'kernel':
        if (p.default.length !== p.size * p.size) fail(`kernel default needs ${p.size * p.size} values`);
        break;
      case 'curve': {
        const problem = curveProblem(p.default);
        if (problem) fail(`curve default: ${problem}`);
        break;
      }
      case 'lut': {
        const problem = lutProblem(p.default);
        if (problem) fail(`lut default: ${problem}`);
        break;
      }
    }
  }
}

export function defaultParams<S extends ParamSchema>(schema: S): ParamValues<S> {
  return Object.fromEntries(Object.entries(schema).map(([k, p]) => [k, p.default])) as ParamValues<S>;
}

/** Fills in defaults, clamps numbers into range (rounding ints) and rejects anything malformed. */
export function resolveParams<S extends ParamSchema>(schema: S, values: Partial<ParamValues<S>> = {}): ParamValues<S> {
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(schema, key)) throw new Error(`unknown parameter "${key}"`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(schema)) {
    const v: unknown = (values as Record<string, unknown>)[key] ?? p.default;
    const bad = () => new TypeError(`parameter "${key}" (${p.type}): invalid value ${JSON.stringify(v)}`);
    switch (p.type) {
      case 'float':
      case 'int': {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw bad();
        const n = p.type === 'int' ? Math.round(v) : v;
        out[key] = Math.min(p.max, Math.max(p.min, n));
        break;
      }
      case 'bool':
        if (typeof v !== 'boolean') throw bad();
        out[key] = v;
        break;
      case 'enum':
        if (typeof v !== 'string' || !Object.hasOwn(p.options, v)) throw bad();
        out[key] = v;
        break;
      case 'kernel':
        if (!Array.isArray(v) || v.length !== p.size * p.size || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw bad();
        out[key] = [...v];
        break;
      case 'curve':
        if (curveProblem(v)) throw bad();
        out[key] = (v as CurvePoints).map(([x, y]) => [x, y]) as never;
        break;
      case 'lut':
        if (lutProblem(v)) throw new TypeError(`parameter "${key}" (lut): ${lutProblem(v)}`);
        out[key] = v; // not copied: GPU textures are cached by object identity
        break;
    }
  }
  return out as unknown as ParamValues<S>;
}

/** Multiplies pixel-unit params by `scale` (output / full resolution), rounding ints, clamped to range. */
export function scaleParams<S extends ParamSchema>(schema: S, values: ParamValues<S>, scale: number): ParamValues<S> {
  if (scale === 1) return values;
  const out: Record<string, unknown> = { ...values };
  for (const [key, p] of Object.entries(schema)) {
    if ((p.type !== 'float' && p.type !== 'int') || p.unit !== 'px') continue;
    const v = (values as Record<string, number>)[key]! * scale;
    out[key] = Math.min(p.max, Math.max(p.min, p.type === 'int' ? Math.round(v) : v));
  }
  return out as ParamValues<S>;
}

interface Field {
  readonly key: string;
  readonly param: Param;
  readonly offset: number;
  readonly wgsl: string;
}

const roundUp = (n: number, k: number) => Math.ceil(n / k) * k;

/** Uniform layout of a schema: field offsets and the padded buffer size (WGSL uniform rules). */
export function paramsLayout(schema: ParamSchema): { fields: Field[]; size: number } {
  const fields: Field[] = [];
  let offset = 0;
  for (const [key, p] of Object.entries(schema)) {
    if (p.type === 'kernel' || p.type === 'curve' || p.type === 'lut') {
      const n = p.type === 'lut' ? 2 : Math.ceil((p.type === 'kernel' ? p.size * p.size : CURVE_SAMPLES) / 4);
      offset = roundUp(offset, 16);
      fields.push({ key, param: p, offset, wgsl: `@align(16) ${key}: array<vec4f, ${n}>` });
      offset += 16 * n;
    } else {
      fields.push({ key, param: p, offset, wgsl: `${key}: ${{ float: 'f32', int: 'i32', bool: 'u32', enum: 'u32' }[p.type as 'float' | 'int' | 'bool' | 'enum']}` });
      offset += 4;
    }
  }
  return { fields, size: Math.max(16, roundUp(offset, 16)) };
}

export function paramsStructWgsl(name: string, schema: ParamSchema): string {
  const fields = paramsLayout(schema).fields.map((f) => `  ${f.wgsl},`);
  // WGSL forbids empty structs.
  if (fields.length === 0) fields.push('  _unused: u32,');
  return `struct ${name} {\n${fields.join('\n')}\n}`;
}

/** Packs resolved values into a uniform buffer laid out like {@link paramsStructWgsl}. */
export function packParams<S extends ParamSchema>(schema: S, values: ParamValues<S>): ArrayBuffer {
  const { fields, size } = paramsLayout(schema);
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  for (const { key, param: p, offset } of fields) {
    const v = (values as Record<string, unknown>)[key];
    switch (p.type) {
      case 'float':
        view.setFloat32(offset, v as number, true);
        break;
      case 'int':
        view.setInt32(offset, v as number, true);
        break;
      case 'bool':
        view.setUint32(offset, v ? 1 : 0, true);
        break;
      case 'enum':
        view.setUint32(offset, Object.keys(p.options).indexOf(v as string), true);
        break;
      case 'kernel':
        (v as number[]).forEach((x, i) => view.setFloat32(offset + i * 4, x, true));
        break;
      case 'curve':
        curveLut(v as CurvePoints).forEach((x, i) => view.setFloat32(offset + i * 4, x, true));
        break;
      case 'lut':
        for (let i = 0; i < 3; i++) {
          view.setFloat32(offset + i * 4, (v as Lut).domainMin[i]!, true);
          view.setFloat32(offset + 16 + i * 4, (v as Lut).domainMax[i]!, true);
        }
        break;
    }
  }
  return buf;
}

/** `curve_<name>(x)` samplers for a schema's curve params, reading `<access>.<name>`. */
export function curveSamplersWgsl(schema: ParamSchema, access: string): string {
  return Object.entries(schema)
    .filter(([, p]) => p.type === 'curve')
    .map(([key]) => curveSamplerWgsl(`curve_${key}`, `${access}.${key}`))
    .join('\n');
}
