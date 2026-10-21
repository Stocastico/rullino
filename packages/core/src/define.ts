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
  const known = new Set(['input']);
  for (const pass of def.passes) {
    if (!IDENTIFIER.test(pass.name) || pass.name === 'input') throw new Error(`${where}: pass name "${pass.name}" must be a WGSL identifier other than "input"`);
    if (known.has(pass.name)) throw new Error(`${where}: duplicate pass name "${pass.name}"`);
    for (const i of pass.inputs) if (!known.has(i)) throw new Error(`${where}: pass "${pass.name}" has unknown input "${i}"`);
    if (!/\bfn\s+run\s*\(/.test(pass.wgsl)) throw new Error(`${where}: pass "${pass.name}" must define fn run(xy: vec2i, p: Params) -> vec4f`);
    if (/\bstruct\s+Params\b/.test(pass.wgsl)) throw new Error(`${where}: wgsl must not declare struct Params (it is generated)`);
    if (pass.repeat !== undefined) {
      if (def.params[pass.repeat]?.type !== 'int') throw new Error(`${where}: pass "${pass.name}" repeat must name an int param`);
      if (pass.inputs.length === 0) throw new Error(`${where}: repeated pass "${pass.name}" needs an input to iterate on`);
    }
    known.add(pass.name);
  }
  const cpu = def.cpu;
  return { ...def, cpu: (src, params) => cpu(src, resolveParams(def.params, params)) };
}

function definePointwise<S extends ParamSchema>(def: PointwiseFilterDef<S>, where: string): PointwiseFilter<S> {
  if (!/\bfn\s+apply\s*\(/.test(def.wgsl)) throw new Error(`${where}: wgsl must define fn apply(c: vec4f, p: Params) -> vec4f`);
  if (/\bstruct\s+Params\b/.test(def.wgsl)) throw new Error(`${where}: wgsl must not declare struct Params (it is generated)`);

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
