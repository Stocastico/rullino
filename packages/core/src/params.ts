// Parameter schema: the contract between a filter, its UI, validation and serialisation.
// Every parameter is one 4-byte uniform field (f32 / i32 / u32), in declaration order.

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
}

export interface IntParam extends ParamBase {
  readonly type: 'int';
  readonly min: number;
  readonly max: number;
  readonly default: number;
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

export type Param = FloatParam | IntParam | BoolParam | EnumParam;
export type ParamSchema = Readonly<Record<string, Param>>;

export type ParamValue<P extends Param> = P extends { readonly type: 'float' | 'int' }
  ? number
  : P extends { readonly type: 'bool' }
    ? boolean
    : P extends { readonly type: 'enum'; readonly options: infer O }
      ? keyof O & string
      : never;

export type ParamValues<S extends ParamSchema> = { readonly [K in keyof S]: ParamValue<S[K]> };

const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]*$/;

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
        if (!Object.hasOwn(p.options, p.default)) fail(`default "${p.default}" is not an option`);
        break;
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
  const out: Record<string, number | boolean | string> = {};
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
    }
  }
  return out as ParamValues<S>;
}

const WGSL_TYPE = { float: 'f32', int: 'i32', bool: 'u32', enum: 'u32' } as const;

export function paramsStructWgsl(name: string, schema: ParamSchema): string {
  const fields = Object.entries(schema).map(([k, p]) => `  ${k}: ${WGSL_TYPE[p.type]},`);
  // WGSL forbids empty structs.
  if (fields.length === 0) fields.push('  _unused: u32,');
  return `struct ${name} {\n${fields.join('\n')}\n}`;
}

/** Packs resolved values into a uniform buffer laid out like {@link paramsStructWgsl}. */
export function packParams<S extends ParamSchema>(schema: S, values: ParamValues<S>): ArrayBuffer {
  const entries = Object.entries(schema);
  const buf = new ArrayBuffer(Math.max(16, Math.ceil((entries.length * 4) / 16) * 16));
  const view = new DataView(buf);
  entries.forEach(([key, p], i) => {
    const v = (values as Record<string, unknown>)[key];
    switch (p.type) {
      case 'float':
        view.setFloat32(i * 4, v as number, true);
        break;
      case 'int':
        view.setInt32(i * 4, v as number, true);
        break;
      case 'bool':
        view.setUint32(i * 4, v ? 1 : 0, true);
        break;
      case 'enum':
        view.setUint32(i * 4, Object.keys(p.options).indexOf(v as string), true);
        break;
    }
  });
  return buf;
}
