import { migrateEdit, parseChain, parseEdit, ParseError, serializeChain, type Filter, type Param, type Step } from '@rullino/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { filters } from './index';

// Property tests over the edit document parsers (#177): whatever JSON comes in, a parser either
// returns or throws a ParseError (anything else is a bug: a TypeError from reading a field that is
// not there, a RangeError from a validator nobody wrapped), and what serializeChain writes, parseChain
// reads back to the same steps. RULLINO_FUZZ_RUNS raises the number of runs (the CI fuzz job).

const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
// Hundreds of cases each: slower than a unit test by nature (and much slower under coverage).
const SLOW = { timeout: 60_000 };
// A failure prints its seed: RULLINO_FUZZ_SEED=<seed> replays it.
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });
const opts = { filters };
const serialisable = filters.filter((f) => (Object.values(f.params) as Param[]).every((p) => p.type !== 'lut' && p.type !== 'image')) as Filter[];

/** A value inside a param's domain, so that serialising and parsing keep it exactly. */
function paramValue(p: Param): fc.Arbitrary<unknown> {
  switch (p.type) {
    case 'float':
      return fc.double({ min: p.min, max: p.max, noNaN: true, noDefaultInfinity: true }).map((v) => (Object.is(v, -0) ? 0 : v));
    case 'int':
      return fc.integer({ min: p.min, max: p.max });
    case 'bool':
      return fc.boolean();
    case 'enum':
      return fc.constantFrom(...Object.keys(p.options));
    case 'kernel':
      return fc.array(fc.double({ min: -4, max: 4, noNaN: true }).map((v) => (Object.is(v, -0) ? 0 : v)), { minLength: p.size * p.size, maxLength: p.size * p.size });
    case 'color':
      return fc.tuple(...[0, 1, 2].map(() => fc.double({ min: 0, max: 1, noNaN: true }).map((v) => (Object.is(v, -0) ? 0 : v))));
    case 'curve':
      // 2 to 8 points with strictly increasing x in [0, 1].
      return fc.uniqueArray(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 8 }).chain((xs) => {
        const sorted = [...xs].sort((a, b) => a - b).map((x) => x / 1000);
        return fc.tuple(...sorted.map((x) => fc.double({ min: 0, max: 1, noNaN: true }).map((y) => [x, Object.is(y, -0) ? 0 : y])));
      });
    default:
      throw new Error(`no arbitrary for ${p.type}`);
  }
}

const step: fc.Arbitrary<Step> = fc.constantFrom(...serialisable).chain((filter) =>
  fc
    .record(Object.fromEntries(Object.entries(filter.params).map(([k, p]) => [k, paramValue(p)])), { requiredKeys: [] })
    .chain((params) => fc.record({ enabled: fc.boolean() }).map(({ enabled }) => ({ filter, params, ...(enabled ? {} : { enabled: false }) }) as Step)),
);

const output = fc.option(
  fc.record({ format: fc.constantFrom('png', 'jpeg', 'webp'), quality: fc.double({ min: 0, max: 1, noNaN: true }), longSide: fc.integer({ min: 1, max: 10_000 }) }, { requiredKeys: [] }),
  { nil: undefined },
);

/** The parser's verdict on `input`: 'ok', or the error it threw. */
function verdict(parse: () => unknown): 'ok' | Error {
  try {
    parse();
    return 'ok';
  } catch (e) {
    return e as Error;
  }
}

const parsesOrRefuses = (parse: () => unknown) => {
  const v = verdict(parse);
  if (v !== 'ok' && !(v instanceof ParseError)) throw new Error(`threw ${v.name} instead of a ParseError: ${v.message}`, { cause: v });
};

/** A valid v3 document: a chain, another chain on it, a masked mix, a resize. */
const graphDoc = () => ({
  version: 3,
  inputs: { photo: {}, logo: {} },
  nodes: [
    { id: 'colour', from: 'photo', steps: [{ filter: 'exposure', params: { ev: 0.5 } }, { filter: 'curves', params: { rgb: [[0, 0], [0.5, 0.6], [1, 1]] } }] },
    { id: 'blur', from: 'colour', geometry: { rotate: 90, flipH: false, flipV: false, straighten: 3, crop: { x: 0, y: 0, width: 1, height: 1 } }, steps: [{ filter: 'gaussianBlur', params: { sigma: 2 }, mask: { kind: 'radial', center: [0.5, 0.5], radius: [0.3, 0.2], feather: 0.4 } }] },
    { id: 'mixed', kind: 'mix', from: ['colour', 'blur'], amount: 0.3, mask: { kind: 'linear', from: [0, 0], to: [1, 1] } },
    { id: 'small', kind: 'resize', from: 'mixed', longSide: 800 },
  ],
  output: { node: 'small', format: 'jpeg', quality: 0.8 },
});

/** Every path to a value inside a JSON value (arrays and objects), the root included. */
function paths(v: unknown, at: (string | number)[] = []): (string | number)[][] {
  const out = [at];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...paths(x, [...at, i])));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) out.push(...paths(x, [...at, k]));
  return out;
}

/** `doc` with the value at `path` replaced (or deleted, for `undefined`). */
function replaced(doc: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const copy = Array.isArray(doc) ? [...doc] : { ...(doc as Record<string, unknown>) };
  const [head, ...rest] = path;
  const next = replaced((doc as Record<string | number, unknown>)[head!], rest, value);
  if (next === undefined && !Array.isArray(copy)) delete (copy as Record<string | number, unknown>)[head!];
  else (copy as Record<string | number, unknown>)[head!] = next;
  return copy;
}

describe('edit document parsers', SLOW, () => {
  it('any JSON value: parseEdit and parseChain return or throw a ParseError', () => {
    const anything = fc.oneof(fc.jsonValue(), fc.record({ version: fc.constantFrom(1, 2, 3, 4, '3', null), steps: fc.jsonValue(), nodes: fc.jsonValue(), inputs: fc.jsonValue(), output: fc.jsonValue() }, { requiredKeys: [] }));
    fc.assert(
      fc.property(anything, (doc) => {
        parsesOrRefuses(() => parseEdit(doc, opts));
        parsesOrRefuses(() => parseChain(doc, opts));
      }),
      { numRuns: RUNS },
    );
  });

  it('a valid graph with one value replaced, removed or retyped: return or ParseError', () => {
    const doc = graphDoc();
    expect(verdict(() => parseEdit(doc, opts))).toBe('ok');
    const all = paths(doc);
    const value = fc.oneof(fc.jsonValue(), fc.constant(undefined), fc.constantFrom(-1, 0, 1e309, -0, 0.5, 2, '', 'photo', 'colour', [], {}, null));
    fc.assert(
      fc.property(fc.constantFrom(...all), value, (path, v) => parsesOrRefuses(() => parseEdit(replaced(doc, path, v), opts))),
      { numRuns: RUNS * 3 },
    );
  });

  it('serializeChain → JSON → parseChain gives the same steps, and serialising again the same document', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 6 }), output, (steps, out) => {
        const doc = JSON.parse(JSON.stringify(serializeChain(steps, out ? { output: out } : {})));
        const back = parseChain(doc, opts);
        expect(back.steps.map((s) => [s.filter.id, s.enabled ?? true])).toEqual(steps.map((s) => [s.filter.id, s.enabled ?? true]));
        expect(JSON.parse(JSON.stringify(serializeChain(back.steps, back.output ? { output: back.output } : {})))).toEqual(doc);
      }),
      { numRuns: RUNS },
    );
  });

  it('a v2 document and its migration parse to the same graph', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 6 }), output, (steps, out) => {
        const v3 = JSON.parse(JSON.stringify(serializeChain(steps, out ? { output: out } : {})));
        const node = v3.nodes[0];
        const v2 = { version: 2, steps: node.steps, ...(v3.output ? { output: v3.output } : {}) };
        expect(parseEdit(migrateEdit(v2), opts)).toEqual(parseEdit(v2, opts));
        expect(parseEdit(v2, opts)).toEqual(parseEdit(v3, opts));
      }),
      { numRuns: RUNS },
    );
  });
});
