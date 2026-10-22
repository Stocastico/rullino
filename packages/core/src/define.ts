import type { MultipassFilter, MultipassFilterDef, PointwiseFilter, PointwiseFilterDef, Rgba } from './filter';
import { createImage } from './image';
import { resolveParams, validateSchema, type ParamSchema, type ParamValues } from './params';

const ID = /^[a-z][a-zA-Z0-9]*$/;
const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function defineFilter<const S extends ParamSchema>(def: PointwiseFilterDef<S>): PointwiseFilter<S>;
export function defineFilter<const S extends ParamSchema>(def: MultipassFilterDef<S>): MultipassFilter<S>;
export function defineFilter<const S extends ParamSchema>(
  def: PointwiseFilterDef<S> | MultipassFilterDef<S>,
): PointwiseFilter<S> | MultipassFilter<S> {
  if (!ID.test(def.id)) throw new Error(`filter id "${def.id}" must be camelCase ([a-z][a-zA-Z0-9]*)`);
  const where = `filter "${def.id}"`;
  try {
    validateSchema(def.params);
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
  return def.kind === 'multipass' ? defineMultipass(def, where) : definePointwise(def, where);
}

function defineMultipass<S extends ParamSchema>(def: MultipassFilterDef<S>, where: string): MultipassFilter<S> {
  if (def.passes.length === 0) throw new Error(`${where}: needs at least one pass`);
  const buffers = def.buffers ?? {};
  for (const [name, n] of Object.entries(buffers)) {
    if (!IDENTIFIER.test(name)) throw new Error(`${where}: buffer name "${name}" must be a WGSL identifier`);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: buffer "${name}" size must be a positive integer`);
  }
  const textures = new Set(def.usesMask ? ['input', 'mask'] : ['input']);
  const computes = new Set<string>();
  for (const pass of def.passes) {
    if (!IDENTIFIER.test(pass.name) || pass.name === 'input' || pass.name === 'mask') throw new Error(`${where}: pass name "${pass.name}" must be a WGSL identifier other than "input" and "mask"`);
    if (textures.has(pass.name) || computes.has(pass.name)) throw new Error(`${where}: duplicate pass name "${pass.name}"`);
    for (const i of pass.inputs) {
      if (computes.has(i)) throw new Error(`${where}: pass "${pass.name}" reads compute pass "${i}", which has no texture output`);
      if (!textures.has(i)) throw new Error(`${where}: pass "${pass.name}" has unknown input "${i}"`);
    }
    for (const b of pass.buffers ?? []) if (!Object.hasOwn(buffers, b)) throw new Error(`${where}: pass "${pass.name}" uses unknown buffer "${b}"`);
    if (!/\bfn\s+run\s*\(/.test(pass.wgsl)) throw new Error(`${where}: pass "${pass.name}" must define fn run(xy: vec2i, p: Params)`);
    if (/\bstruct\s+Params\b/.test(pass.wgsl)) throw new Error(`${where}: wgsl must not declare struct Params (it is generated)`);
    if (pass.kind === 'compute') {
      if (pass.inputs.length === 0) throw new Error(`${where}: compute pass "${pass.name}" needs an input (it sets the dispatch size)`);
      computes.add(pass.name);
      continue;
    }
    if (pass.repeat !== undefined) {
      if (def.params[pass.repeat]?.type !== 'int') throw new Error(`${where}: pass "${pass.name}" repeat must name an int param`);
      if (pass.inputs.length === 0) throw new Error(`${where}: repeated pass "${pass.name}" needs an input to iterate on`);
    }
    textures.add(pass.name);
  }
  if (def.passes.at(-1)!.kind === 'compute') throw new Error(`${where}: the last pass must write a texture (it is the output)`);
  const cpu = def.cpu;
  return {
    ...def,
    cpu(src, params, mask) {
      if (def.usesMask && !mask) throw new Error(`${where} needs a mask`);
      if (mask && mask.length !== src.width * src.height) throw new RangeError(`${where}: mask has ${mask.length} values for ${src.width}x${src.height}`);
      return cpu(src, resolveParams(def.params, params), mask);
    },
  };
}

function definePointwise<S extends ParamSchema>(def: PointwiseFilterDef<S>, where: string): PointwiseFilter<S> {
  if (!/\bfn\s+apply\s*\(/.test(def.wgsl)) throw new Error(`${where}: wgsl must define fn apply(c: vec4f, p: Params) -> vec4f`);
  if (/\bstruct\s+Params\b/.test(def.wgsl)) throw new Error(`${where}: wgsl must not declare struct Params (it is generated)`);
  for (const [key, p] of Object.entries(def.params))
    if (p.type === 'lut' || p.type === 'image') throw new Error(`${where}: param "${key}": ${p.type} params need a multipass filter (they bind a texture)`);

  const straight = def.alpha === 'straight';
  return {
    ...def,
    cpu(src, params) {
      const p: ParamValues<S> = resolveParams(def.params, params);
      const out = createImage(src.width, src.height);
      const s = src.data;
      const d = out.data;
      for (let i = 0; i < s.length; i += 4) {
        const a = s[i + 3]!;
        let c: Rgba;
        if (!straight) c = [s[i]!, s[i + 1]!, s[i + 2]!, a];
        else if (a > 0) c = [s[i]! / a, s[i + 1]! / a, s[i + 2]! / a, a];
        else c = [0, 0, 0, a];

        const [r, g, b, oa] = def.pixel(c, p);
        const k = straight ? oa : 1;
        d[i] = r * k;
        d[i + 1] = g * k;
        d[i + 2] = b * k;
        d[i + 3] = oa;
      }
      return out;
    },
  };
}
