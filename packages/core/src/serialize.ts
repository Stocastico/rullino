import type { ExportOptions } from './encode';
import type { Filter } from './filter';
import { validateGeometry, type Geometry } from './geometry';
import type { Lut } from './lut';
import { createRasterMask, validateMask, type Mask } from './mask';
import type { Step } from './pipeline/chain';
import { resolveParams, type ParamSchema } from './params';

// An edit as plain JSON: the chain, optionally its geometry and how to export the result. For share
// links, saved presets, files and server renders. Params equal to their defaults are left out, raster
// masks are stored as 8-bit coverage in base64, and LUTs only by reference (a LUT's table is far too
// large for a link): the caller names them. edit.schema.json describes the same format.

/** Version 2 added `output`; version 1 documents are migrated by {@link migrateChain}. */
export const CHAIN_VERSION = 2;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type MaskDocument =
  | Exclude<Mask, { kind: 'raster' }>
  | { readonly kind: 'raster'; readonly width: number; readonly height: number; readonly data: string; readonly invert?: boolean; readonly opacity?: number };

export interface StepDocument {
  /** The filter's id. */
  readonly filter: string;
  /** Only the params that differ from their defaults; a LUT is `{ ref }`. */
  readonly params: Readonly<Record<string, Json>>;
  readonly enabled?: false;
  readonly mask?: MaskDocument;
}

/** How to export the result: the encoding options plus an optional size. */
export interface OutputSettings extends ExportOptions {
  /** Shrink (in linear light, after the chain) so the long side is at most this many pixels. Never enlarges. */
  readonly longSide?: number;
}

export interface ChainDocument {
  readonly version: typeof CHAIN_VERSION;
  readonly steps: readonly StepDocument[];
  readonly geometry?: Geometry;
  readonly output?: OutputSettings;
}

export interface SerializeOptions {
  readonly geometry?: Geometry;
  readonly output?: OutputSettings;
  /** A stable name for a LUT (e.g. 'look:teal-orange'), or undefined if it cannot be referenced. */
  readonly lutRef?: (lut: Lut) => string | undefined;
}

export interface ParseOptions {
  /** The filters a document may use, looked up by id. */
  readonly filters: readonly Filter<any>[];
  /** The LUT a reference names, or undefined if unknown. */
  readonly resolveLut?: (ref: string) => Lut | undefined;
}

export function serializeChain(steps: readonly Step[], options: SerializeOptions = {}): ChainDocument {
  return {
    version: CHAIN_VERSION,
    steps: steps.map((step) => {
      const params: Record<string, Json> = {};
      const values = resolveParams(step.filter.params, (step.params ?? {}) as never) as Record<string, unknown>;
      for (const [key, p] of Object.entries(step.filter.params as ParamSchema)) {
        const v = values[key];
        if (p.type === 'lut') {
          if (v === p.default) continue;
          const ref = options.lutRef?.(v as Lut);
          if (ref === undefined) throw new Error(`step "${step.filter.id}": its LUT "${(v as Lut).title ?? 'untitled'}" has no reference and cannot be serialised`);
          params[key] = { ref };
        } else if (p.type === 'image') {
          if (v !== p.default) throw new Error(`step "${step.filter.id}": its image param "${key}" cannot be serialised`);
        } else if (JSON.stringify(v) !== JSON.stringify(p.default)) params[key] = v as Json;
      }
      return {
        filter: step.filter.id,
        params,
        ...(step.enabled === false ? { enabled: false as const } : {}),
        ...(step.mask ? { mask: maskDocument(step.mask) } : {}),
      };
    }),
    ...(options.geometry ? { geometry: options.geometry } : {}),
    ...(options.output ? { output: parseOutput(options.output) } : {}),
  };
}

/**
 * Brings an older document up to the current version (a new object; the input is not changed).
 * Version 1 is version 2 without `output`. Does not validate the steps: {@link parseChain} does.
 */
export function migrateChain(doc: unknown): ChainDocument {
  if (!isObject(doc)) throw new Error('chain: not an object');
  if (doc.version === CHAIN_VERSION) return doc as unknown as ChainDocument;
  if (doc.version === 1) return { ...doc, version: CHAIN_VERSION } as unknown as ChainDocument;
  throw new Error(`chain: unsupported version ${JSON.stringify(doc.version)}`);
}

/** Validates a document (e.g. parsed from a link) and turns it back into chain steps. */
export function parseChain(input: unknown, options: ParseOptions): { steps: Step[]; geometry?: Geometry; output?: OutputSettings } {
  const doc = migrateChain(input) as unknown as Record<string, unknown>;
  if (!Array.isArray(doc.steps)) throw new Error('chain: steps must be an array');
  const byId = new Map(options.filters.map((f) => [f.id, f]));
  const steps = doc.steps.map((s: unknown, i): Step => {
    if (!isObject(s) || typeof s.filter !== 'string') throw new Error(`chain step ${i}: missing filter id`);
    const filter = byId.get(s.filter);
    if (!filter) throw new Error(`chain step ${i}: unknown filter "${s.filter}"`);
    const raw = s.params ?? {};
    if (!isObject(raw)) throw new Error(`chain step ${i}: params must be an object`);
    const params: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(raw)) {
      if (filter.params[key]?.type === 'lut') {
        const ref = isObject(v) && typeof v.ref === 'string' ? v.ref : undefined;
        const lut = ref === undefined ? undefined : options.resolveLut?.(ref);
        if (!lut) throw new Error(`chain step ${i} (${filter.id}): unknown LUT ${JSON.stringify(ref ?? v)}`);
        params[key] = lut;
      } else params[key] = v;
    }
    try {
      resolveParams(filter.params, params as never);
    } catch (e) {
      throw new Error(`chain step ${i} (${filter.id}): ${(e as Error).message}`);
    }
    const mask = s.mask === undefined ? undefined : parseMask(s.mask);
    return { filter, params, enabled: s.enabled !== false, ...(mask ? { mask } : {}) };
  });
  return {
    steps,
    ...(doc.geometry !== undefined ? { geometry: parseGeometry(doc.geometry) } : {}),
    ...(doc.output !== undefined ? { output: parseOutput(doc.output) } : {}),
  };
}

const OUTPUT_KEYS = new Set(['format', 'quality', 'bitDepth', 'background', 'longSide']);

/** Validates output settings and rebuilds them from known fields. */
function parseOutput(o: unknown): OutputSettings {
  if (!isObject(o)) throw new Error('output: not an object');
  for (const key of Object.keys(o)) if (!OUTPUT_KEYS.has(key)) throw new Error(`output: unknown setting "${key}"`);
  const { format, quality, bitDepth, background, longSide } = o;
  if (format !== undefined && format !== 'png' && format !== 'jpeg' && format !== 'webp') throw new Error(`output: format must be png, jpeg or webp, got ${JSON.stringify(format)}`);
  if (quality !== undefined && !(typeof quality === 'number' && quality >= 0 && quality <= 1)) throw new Error('output: quality must be a number in [0, 1]');
  if (bitDepth !== undefined && bitDepth !== 8 && bitDepth !== 16) throw new Error('output: bitDepth must be 8 or 16');
  if (bitDepth === 16 && (format ?? 'png') !== 'png') throw new Error('output: bitDepth 16 needs format png');
  if (longSide !== undefined && !(Number.isInteger(longSide) && (longSide as number) >= 1)) throw new Error('output: longSide must be a positive integer');
  if (background !== undefined && !(Array.isArray(background) && background.length === 3 && background.every((c) => typeof c === 'number' && c >= 0 && c <= 1))) {
    throw new Error('output: background must be [r, g, b] in [0, 1]');
  }
  return {
    ...(format !== undefined ? { format } : {}),
    ...(quality !== undefined ? { quality: quality as number } : {}),
    ...(bitDepth !== undefined ? { bitDepth } : {}),
    ...(background !== undefined ? { background: [...(background as number[])] as [number, number, number] } : {}),
    ...(longSide !== undefined ? { longSide: longSide as number } : {}),
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function maskDocument(m: Mask): MaskDocument {
  if (m.kind !== 'raster') return m;
  const { raster, ...rest } = m;
  const bytes = new Uint8Array(raster.data.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, raster.data[i]!)) * 255);
  return { ...rest, width: raster.width, height: raster.height, data: toBase64(bytes) };
}

const vec2 = (v: unknown): readonly [number, number] => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number')) throw new Error('mask: points must be [x, y] number pairs');
  return [v[0] as number, v[1] as number];
};

/** Rebuilds a mask from known fields only, then validates it. */
function parseMask(m: unknown): Mask {
  if (!isObject(m)) throw new Error('mask: not an object');
  const options = {
    ...(m.invert !== undefined ? { invert: m.invert === true } : {}),
    ...(m.opacity !== undefined ? { opacity: Number(m.opacity) } : {}),
  };
  let mask: Mask;
  switch (m.kind) {
    case 'linear':
      mask = { kind: 'linear', from: vec2(m.from), to: vec2(m.to), ...options };
      break;
    case 'radial':
      mask = { kind: 'radial', center: vec2(m.center), radius: vec2(m.radius), feather: Number(m.feather), ...options };
      break;
    case 'raster': {
      const { width, height, data } = m;
      if (!Number.isInteger(width) || !Number.isInteger(height) || typeof data !== 'string') throw new Error('mask (raster): needs integer width, height and base64 data');
      const bytes = fromBase64(data);
      const values = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) values[i] = bytes[i]! / 255;
      mask = { kind: 'raster', raster: createRasterMask(width as number, height as number, values), ...options };
      break;
    }
    default:
      throw new Error(`mask: unknown kind ${JSON.stringify(m.kind)}`);
  }
  validateMask(mask);
  return mask;
}

function parseGeometry(g: unknown): Geometry {
  if (!isObject(g) || !isObject(g.crop)) throw new Error('geometry: not an object with a crop');
  const { x, y, width, height } = g.crop;
  const geometry: Geometry = {
    rotate: g.rotate as Geometry['rotate'],
    flipH: g.flipH === true,
    flipV: g.flipV === true,
    straighten: Number(g.straighten),
    crop: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) },
    ...(g.perspective !== undefined
      ? {
          perspective: (() => {
            if (!Array.isArray(g.perspective) || g.perspective.length !== 4) throw new Error('geometry: perspective needs 4 points');
            return g.perspective.map(vec2) as unknown as NonNullable<Geometry['perspective']>;
          })(),
        }
      : {}),
  };
  validateGeometry(geometry);
  return geometry;
}

// btoa / atob work on "binary strings"; chunks keep String.fromCharCode's argument list short.
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
