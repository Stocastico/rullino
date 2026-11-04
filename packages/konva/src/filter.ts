import { parseChain, type Filter, type Lut } from '@rullino/core';
import { filters as allFilters } from '@rullino/filters';
import { bakeLut, resolveLookLut } from '@rullino/presets';

export interface KonvaFilterOptions {
  /** The filters the document may use. Default: every filter of `@rullino/filters`. */
  readonly filters?: readonly Filter<any>[];
  /** Resolves LUT names in the document. Default: the looks of `@rullino/presets` (`look:<id>`). */
  readonly resolveLut?: (ref: string) => Lut | undefined;
}

/** What Konva hands a filter: the node's 8-bit straight-alpha pixels, changed in place. */
export interface FilterPixels {
  readonly data: Uint8ClampedArray;
}

/**
 * A synchronous Konva filter from an edit document: `node.filters([konvaFilter(doc)])` then
 * `node.cache()`, or register it by name (`Konva.Filters.Noir = konvaFilter(doc)`) for tools that
 * look filters up by name. Konva filters cannot wait for the GPU, so this runs on the CPU, and only
 * for **colour edits** (exposure, curves, saturation, LUTs...: steps that turn each pixel's colour
 * into another, no masks): the whole document is baked once into a 33³ colour LUT and every
 * pixel costs one lookup. The result differs from the full renderers by less than a level on
 * average (a few levels at the gamut edge), and HDR values above 1 are clamped.
 *
 * It throws when the document needs more (blur, vignette, a mask, geometry), instead of silently
 * doing less; the document's `output` settings and switched-off steps are ignored.
 */
export function konvaFilter(edit: unknown, options: KonvaFilterOptions = {}): (imageData: FilterPixels) => void {
  const { steps, geometry } = parseChain(edit, { filters: options.filters ?? allFilters, resolveLut: options.resolveLut ?? resolveLookLut });
  if (geometry && (geometry.rotate !== 0 || geometry.flipH || geometry.flipV || geometry.straighten !== 0 || geometry.perspective || geometry.crop.x !== 0 || geometry.crop.y !== 0 || geometry.crop.width !== 1 || geometry.crop.height !== 1)) {
    throw new Error('konvaFilter: the document has a geometry (crop, turn, perspective); a Konva filter cannot change the picture\'s frame');
  }
  for (const [i, s] of steps.entries()) {
    if (s.enabled === false) continue;
    if (!(s.filter.kind === 'pointwise' || s.filter.perPixel)) throw new Error(`konvaFilter: step ${i} (${s.filter.id}) is not a colour step; only edits that change each pixel's colour on its own are supported`);
    if (s.mask) throw new Error(`konvaFilter: step ${i} (${s.filter.id}) has a mask; only whole-picture colour steps are supported`);
  }
  const lut = bakeLut(steps);
  const n = lut.size - 1;
  const { data: table } = lut;
  const sr = 3, sg = 3 * lut.size, sb = sg * lut.size;

  return ({ data }) => {
    for (let i = 0; i < data.length; i += 4) {
      const pr = (data[i]! / 255) * n, pg = (data[i + 1]! / 255) * n, pb = (data[i + 2]! / 255) * n;
      const r0 = Math.min(pr | 0, n - 1), g0 = Math.min(pg | 0, n - 1), b0 = Math.min(pb | 0, n - 1);
      const fr = pr - r0, fg = pg - g0, fb = pb - b0;
      const base = b0 * sb + g0 * sg + r0 * sr;
      for (let c = 0; c < 3; c++) {
        const k = base + c;
        const c00 = table[k]! + (table[k + sr]! - table[k]!) * fr;
        const c10 = table[k + sg]! + (table[k + sg + sr]! - table[k + sg]!) * fr;
        const c01 = table[k + sb]! + (table[k + sb + sr]! - table[k + sb]!) * fr;
        const c11 = table[k + sb + sg]! + (table[k + sb + sg + sr]! - table[k + sb + sg]!) * fr;
        const lo = c00 + (c10 - c00) * fg;
        data[i + c] = (lo + (c01 + (c11 - c01) * fg - lo) * fb) * 255; // the clamped array clamps and rounds
      }
    }
  };
}
