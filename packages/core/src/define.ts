import type { PointwiseFilter, PointwiseFilterDef, Rgba } from './filter';
import { createImage } from './image';
import { resolveParams, validateSchema, type ParamSchema, type ParamValues } from './params';

const ID = /^[a-z][a-zA-Z0-9]*$/;

export function defineFilter<const S extends ParamSchema>(def: PointwiseFilterDef<S>): PointwiseFilter<S> {
  if (!ID.test(def.id)) throw new Error(`filter id "${def.id}" must be camelCase ([a-z][a-zA-Z0-9]*)`);
  const where = `filter "${def.id}"`;
  try {
    validateSchema(def.params);
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
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
