import { describe, expect, it } from 'vitest';
import { defineFilter } from './define';
import { IDENTITY_GEOMETRY } from './geometry';
import { chainDocument, EDIT_VERSION, migrateEdit, parseEdit, type EditDocument } from './graph';
import { parseChain } from './serialize';

const gain = defineFilter({
  id: 'gain',
  label: 'Gain',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: { amount: { type: 'float', min: 0, max: 4, step: 0.1, default: 1, label: 'Amount' } },
  wgsl: 'fn apply(c: vec4f, p: Params) -> vec4f { return c; }',
  pixel: (c) => c,
  tolerance: { abs: 0, rel: 0 },
});
const filters = [gain];
const opts = { filters };

const v2 = {
  version: 2,
  geometry: { ...IDENTITY_GEOMETRY, rotate: 90 },
  steps: [{ filter: 'gain', params: { amount: 2 } }, { filter: 'gain', params: {}, enabled: false, mask: { kind: 'linear', from: [0, 0], to: [1, 1] } }],
  output: { format: 'jpeg', quality: 0.8, longSide: 512 },
};

/** A small valid v3 document: a chain, a second chain on it, a mix of the two, a resize. */
const graph = (): EditDocument =>
  ({
    version: 3,
    inputs: { photo: {} },
    nodes: [
      { id: 'colour', from: 'photo', steps: [{ filter: 'gain', params: { amount: 1.5 } }] },
      { id: 'mono', from: 'colour', steps: [{ filter: 'gain', params: { amount: 0.5 } }] },
      { id: 'blend', kind: 'mix', from: ['colour', 'mono'], amount: 0.25 },
      { id: 'small', kind: 'resize', from: 'blend', longSide: 64 },
    ],
    output: { node: 'small', format: 'png' },
  }) as unknown as EditDocument;

describe('migrateEdit', () => {
  it('lifts v1 and v2 to one input and one chain node, keeping steps, geometry and output', () => {
    const doc = migrateEdit(v2);
    expect(doc).toEqual({
      version: EDIT_VERSION,
      inputs: { main: {} },
      nodes: [{ id: 'edit', from: 'main', steps: v2.steps, geometry: v2.geometry }],
      output: v2.output,
    });
    expect(migrateEdit({ version: 1, steps: [] })).toEqual({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [] }] });
  });

  it('returns a v3 document as it is, and refuses unknown versions', () => {
    const g = graph();
    expect(migrateEdit(g)).toBe(g);
    expect(() => migrateEdit({ version: 4 })).toThrow(/unsupported version 4/);
    expect(() => migrateEdit('x')).toThrow(/not an object/);
  });
});

describe('parseEdit', () => {
  it('reads a v2 document as the same steps, geometry and output as parseChain', () => {
    const g = parseEdit(v2, opts);
    const c = parseChain(v2, opts);
    expect(g.inputs).toEqual(['main']);
    expect(g.nodes).toHaveLength(1);
    const node = g.nodes[0]!;
    expect(node.kind).toBe('chain');
    if (node.kind !== 'chain') return;
    expect(node.steps).toEqual(c.steps);
    expect(node.geometry).toEqual(c.geometry);
    expect(g.output).toEqual({ ...c.output, node: 'edit' });
  });

  it('parses every node kind with its fields and defaults', () => {
    const g = parseEdit(graph(), opts);
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([['colour', 'chain'], ['mono', 'chain'], ['blend', 'mix'], ['small', 'resize']]);
    expect(g.nodes[2]).toMatchObject({ kind: 'mix', from: ['colour', 'mono'], amount: 0.25 });
    expect(g.nodes[3]).toMatchObject({ kind: 'resize', from: ['blend'], longSide: 64 });
    expect(g.output).toEqual({ node: 'small', format: 'png' });
    const half = parseEdit({ ...graph(), nodes: [{ id: 'a', kind: 'mix', from: ['photo', 'photo'] }], output: {} }, opts);
    expect(half.nodes[0]).toMatchObject({ amount: 0.5 });
  });

  it('accepts any order and sorts the nodes so each comes after what it reads, ties in list order', () => {
    const doc = graph() as unknown as { nodes: unknown[] };
    const shuffled = { ...graph(), nodes: [doc.nodes[3], doc.nodes[2], doc.nodes[1], doc.nodes[0]] };
    expect(parseEdit(shuffled, opts).nodes.map((n) => n.id)).toEqual(['colour', 'mono', 'blend', 'small']);
    // Two independent chains keep the order they are listed in.
    const pair = {
      version: 3,
      inputs: { a: {}, b: {} },
      nodes: [
        { id: 'out', kind: 'mix', from: ['y', 'x'] },
        { id: 'y', from: 'b', steps: [] },
        { id: 'x', from: 'a', steps: [] },
      ],
      output: { node: 'out' },
    };
    expect(parseEdit(pair, opts).nodes.map((n) => n.id)).toEqual(['y', 'x', 'out']);
  });

  it('defaults the output to the last node in the list, and leaves out nodes it does not need, naming them', () => {
    const doc = { ...graph(), output: { format: 'png' } };
    expect(parseEdit(doc, opts).output.node).toBe('small');
    const extra = { ...graph(), inputs: { photo: {}, logo: {} }, output: { node: 'mono' } };
    const g = parseEdit(extra, opts);
    expect(g.nodes.map((n) => n.id)).toEqual(['colour', 'mono']);
    expect(g.inputs).toEqual(['photo']);
    expect(g.unused).toEqual(['logo', 'blend', 'small']);
  });

  it('rejects cycles, naming them', () => {
    const two = { version: 3, inputs: { p: {} }, nodes: [{ id: 'a', from: 'b', steps: [] }, { id: 'b', from: 'a', steps: [] }] };
    expect(() => parseEdit(two, opts)).toThrow(/a → b → a form a cycle/);
    const three = {
      version: 3,
      inputs: { p: {} },
      nodes: [{ id: 'a', from: 'c', steps: [] }, { id: 'b', from: 'a', steps: [] }, { id: 'c', kind: 'mix', from: ['p', 'b'] }],
    };
    expect(() => parseEdit(three, opts)).toThrow(/a → c → b → a form a cycle|form a cycle/);
    const self = { version: 3, inputs: { p: {} }, nodes: [{ id: 'a', kind: 'mix', from: ['p', 'a'] }] };
    expect(() => parseEdit(self, opts)).toThrow(/a → a form a cycle/);
  });

  it('rejects malformed documents with a message that says where', () => {
    const bad = (patch: Record<string, unknown>) => () => parseEdit({ ...graph(), output: {}, ...patch }, opts);
    expect(bad({ inputs: {} })).toThrow(/inputs: at least one/);
    expect(bad({ inputs: { Photo: {} } })).toThrow(/input "Photo": names are/);
    expect(bad({ inputs: { photo: { profile: 'srgb' } } })).toThrow(/input "photo": unknown setting "profile"/);
    expect(bad({ nodes: [] })).toThrow(/nodes: at least one/);
    expect(bad({ nodes: [{ id: 'a', kind: 'blur', from: 'photo' }] })).toThrow(/node "a": unknown kind "blur" \(known: chain, mix, resize\)/);
    expect(bad({ nodes: [{ id: 'photo', from: 'photo', steps: [] }] })).toThrow(/node "photo": the name is already an input/);
    expect(bad({ nodes: [{ id: 'a', from: 'photo', steps: [] }, { id: 'a', from: 'photo', steps: [] }] })).toThrow(/node "a": two nodes have this id/);
    expect(bad({ nodes: [{ id: 'a', from: 'nowhere', steps: [] }] })).toThrow(/node "a": reads "nowhere", which is neither an input nor a node/);
    expect(bad({ nodes: [{ id: 'a', kind: 'mix', from: ['photo'] }] })).toThrow(/node "a" \(mix\): from must list two names/);
    expect(bad({ nodes: [{ id: 'a', from: ['photo', 'photo'], steps: [] }] })).toThrow(/node "a" \(chain\): from must be one name/);
    expect(bad({ nodes: [{ id: 'a', kind: 'mix', from: ['photo', 'photo'], amount: 2 }] })).toThrow(/node "a" \(mix\): amount must be a number in \[0, 1\]/);
    expect(bad({ nodes: [{ id: 'a', kind: 'resize', from: 'photo' }] })).toThrow(/node "a" \(resize\): needs longSide or scale/);
    expect(bad({ nodes: [{ id: 'a', kind: 'resize', from: 'photo', longSide: 10, scale: 0.5 }] })).toThrow(/node "a" \(resize\): longSide and scale exclude each other/);
    expect(bad({ nodes: [{ id: 'a', kind: 'resize', from: 'photo', scale: 1.5 }] })).toThrow(/node "a" \(resize\): scale must be in \(0, 1\]/);
    expect(bad({ nodes: [{ id: 'a', kind: 'mix', from: ['photo', 'photo'], steps: [] }] })).toThrow(/node "a" \(mix\): unknown field "steps"/);
    expect(bad({ nodes: [{ id: 'a', from: 'photo', steps: [{ filter: 'nope', params: {} }] }] })).toThrow(/node "a" step 0: unknown filter "nope"/);
    expect(bad({ output: { node: 'photo' } })).toThrow(/output: node "photo" is not a node/);
    expect(bad({ output: { node: 'small', size: 3 } })).toThrow(/output: unknown setting "size"/);
  });

  it('keeps parseChain’s messages for v2 documents', () => {
    expect(() => parseEdit({ version: 2, steps: [{ filter: 'nope' }] }, opts)).toThrow(/chain step 0: unknown filter "nope"/);
  });
});

describe('chainDocument', () => {
  it('is the steps of one chain node as a version 2 document (what a band worker parses again)', () => {
    expect(chainDocument(graph(), 'mono')).toEqual({ version: 2, steps: [{ filter: 'gain', params: { amount: 0.5 } }] });
    expect(chainDocument(v2, 'edit')).toEqual({ version: 2, steps: v2.steps });
    expect(parseChain(chainDocument(graph(), 'colour'), opts).steps).toEqual((parseEdit(graph(), opts).nodes[0] as { steps: unknown }).steps);
  });

  it('refuses a node that is not a chain or does not exist', () => {
    expect(() => chainDocument(graph(), 'blend')).toThrow(/node "blend" is not a chain/);
    expect(() => chainDocument(graph(), 'nope')).toThrow(/node "nope" is not a chain/);
  });
});

