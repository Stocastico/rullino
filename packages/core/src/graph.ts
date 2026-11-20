// Edit document v3 (RFC #174, docs/design/edit-document-v3.md): named inputs and a graph of nodes.
// A v1 / v2 document is the one-input, one-chain case and is lifted by `migrateEdit`. Parsing checks
// every node, sorts them (each after what it reads; ties in list order), rejects cycles and leaves
// out what the output does not need. Rendering graphs is the executor's job (#175).
import type { Geometry } from './geometry';
import type { Mask } from './mask';
import type { Step } from './pipeline/chain';
import { isObject, migrateChain, parseGeometry, parseMask, parseOutput, parseSteps, type Json, type MaskDocument, type OutputSettings, type ParseOptions, type StepDocument } from './serialize';

export const EDIT_VERSION = 3;

/** The node kinds a v3 document may use. */
export const NODE_KINDS = ['chain', 'mix', 'resize'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** A node of a v3 document, as JSON. */
export type NodeDocument =
  | { readonly id: string; readonly kind?: 'chain'; readonly from: string; readonly steps: readonly StepDocument[]; readonly geometry?: Geometry }
  | { readonly id: string; readonly kind: 'mix'; readonly from: readonly [string, string]; readonly amount?: number; readonly mask?: MaskDocument }
  | { readonly id: string; readonly kind: 'resize'; readonly from: string; readonly longSide?: number; readonly scale?: number };

/** An edit document of version 3, as JSON. */
export interface EditDocument {
  readonly version: typeof EDIT_VERSION;
  /** The images the document needs, by name. The values are reserved for hints (today `{}`). */
  readonly inputs: Readonly<Record<string, Readonly<Record<string, Json>>>>;
  readonly nodes: readonly NodeDocument[];
  /** Encoding and size of the result, and the node to render (default: the last one listed). */
  readonly output?: OutputSettings & { readonly node?: string };
}

/** A parsed node. `from` is always a list: one name, or two for `mix`. */
export type GraphNode =
  | { readonly kind: 'chain'; readonly id: string; readonly from: readonly [string]; readonly steps: readonly Step[]; readonly geometry?: Geometry }
  | { readonly kind: 'mix'; readonly id: string; readonly from: readonly [string, string]; readonly amount: number; readonly mask?: Mask }
  | { readonly kind: 'resize'; readonly id: string; readonly from: readonly [string]; readonly longSide?: number; readonly scale?: number };

/** A parsed, checked document: only what the output needs, nodes in the order of work. */
export interface EditGraph {
  /** The inputs the output needs, in the order the document lists them. */
  readonly inputs: readonly string[];
  /** The nodes the output needs, each after the nodes it reads (ties in list order). */
  readonly nodes: readonly GraphNode[];
  readonly output: OutputSettings & { readonly node: string };
  /** Inputs and nodes the output does not need (left out above), in list order: often a typo. */
  readonly unused: readonly string[];
}

const NAME = /^[a-z][a-z0-9-]*$/;
const LEGACY_INPUT = 'main';
const LEGACY_NODE = 'edit';
const FIELDS: Record<NodeKind, readonly string[]> = {
  chain: ['id', 'kind', 'from', 'steps', 'geometry'],
  mix: ['id', 'kind', 'from', 'amount', 'mask'],
  resize: ['id', 'kind', 'from', 'longSide', 'scale'],
};

/**
 * Brings any document up to version 3 (a new object; a v3 document is returned as it is). v1 / v2
 * become one input `main` and one chain node `edit` with the same steps, geometry and output.
 * Does not validate: {@link parseEdit} does.
 */
export function migrateEdit(doc: unknown): EditDocument {
  if (!isObject(doc)) throw new Error('edit: not an object');
  if (doc.version === EDIT_VERSION) return doc as unknown as EditDocument;
  if (doc.version !== 1 && doc.version !== 2) throw new Error(`edit: unsupported version ${JSON.stringify(doc.version)}`);
  const { steps, geometry, output } = migrateChain(doc);
  return {
    version: EDIT_VERSION,
    inputs: { [LEGACY_INPUT]: {} },
    nodes: [{ id: LEGACY_NODE, from: LEGACY_INPUT, steps, ...(geometry !== undefined ? { geometry } : {}) }],
    ...(output !== undefined ? { output } : {}),
  };
}

/** Validates a document of any version and turns it into a graph ready to render. */
export function parseEdit(input: unknown, options: ParseOptions): EditGraph {
  const legacy = isObject(input) && (input.version === 1 || input.version === 2);
  const doc = migrateEdit(input) as unknown as Record<string, unknown>;

  if (!isObject(doc.inputs) || Object.keys(doc.inputs).length === 0) throw new Error('inputs: at least one input is needed');
  const inputNames = Object.keys(doc.inputs);
  for (const name of inputNames) {
    if (!NAME.test(name)) throw new Error(`input "${name}": names are lower-case letters, digits and "-", starting with a letter`);
    const hints = doc.inputs[name];
    if (!isObject(hints)) throw new Error(`input "${name}": must be an object`);
    for (const key of Object.keys(hints)) throw new Error(`input "${name}": unknown setting "${key}"`);
  }
  const inputs = new Set(inputNames);

  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) throw new Error('nodes: at least one node is needed');
  const listed = doc.nodes.map((raw, i) => parseNode(raw, i, inputs, options, legacy));
  const byId = new Map<string, GraphNode>();
  for (const node of listed) {
    if (byId.has(node.id)) throw new Error(`node "${node.id}": two nodes have this id`);
    byId.set(node.id, node);
  }
  for (const node of listed)
    for (const name of node.from) if (!inputs.has(name) && !byId.has(name)) throw new Error(`node "${node.id}": reads "${name}", which is neither an input nor a node`);

  const out = doc.output === undefined ? {} : doc.output;
  const settings = parseOutput(out, ['node']);
  const outNode = isObject(out) && out.node !== undefined ? out.node : listed[listed.length - 1]!.id;
  if (typeof outNode !== 'string' || !byId.has(outNode)) throw new Error(`output: node ${JSON.stringify(outNode)} is not a node`);

  const sorted = sortNodes(listed, byId);
  // What the output needs: walk back from it.
  const needed = new Set<string>();
  const visit = (name: string) => {
    if (needed.has(name)) return;
    needed.add(name);
    for (const n of byId.get(name)?.from ?? []) visit(n);
  };
  visit(outNode);
  return {
    inputs: inputNames.filter((n) => needed.has(n)),
    nodes: sorted.filter((n) => needed.has(n.id)),
    output: { ...settings, node: outNode },
    unused: [...inputNames, ...listed.map((n) => n.id)].filter((n) => !needed.has(n)),
  };
}

function parseNode(raw: unknown, i: number, inputs: ReadonlySet<string>, options: ParseOptions, legacy: boolean): GraphNode {
  if (!isObject(raw)) throw new Error(`node ${i}: not an object`);
  const id = raw.id;
  if (typeof id !== 'string' || !NAME.test(id)) throw new Error(`node ${i}: id ${JSON.stringify(id)} must be lower-case letters, digits and "-", starting with a letter`);
  if (inputs.has(id)) throw new Error(`node "${id}": the name is already an input`);
  const kind = raw.kind ?? 'chain';
  if (!(NODE_KINDS as readonly unknown[]).includes(kind)) throw new Error(`node "${id}": unknown kind ${JSON.stringify(kind)} (known: ${NODE_KINDS.join(', ')})`);
  const k = kind as NodeKind;
  const where = `node "${id}" (${k})`;
  for (const key of Object.keys(raw)) if (!FIELDS[k].includes(key)) throw new Error(`${where}: unknown field "${key}"`);

  if (k === 'mix') {
    const from = raw.from;
    if (!Array.isArray(from) || from.length !== 2 || !from.every((f) => typeof f === 'string')) throw new Error(`${where}: from must list two names`);
    const amount = raw.amount ?? 0.5;
    if (typeof amount !== 'number' || !(amount >= 0 && amount <= 1)) throw new Error(`${where}: amount must be a number in [0, 1]`);
    const mask = raw.mask === undefined ? undefined : parseMask(raw.mask);
    return { kind: 'mix', id, from: [from[0] as string, from[1] as string], amount, ...(mask ? { mask } : {}) };
  }
  if (typeof raw.from !== 'string') throw new Error(`${where}: from must be one name`);
  const from: [string] = [raw.from];
  if (k === 'resize') {
    const { longSide, scale } = raw;
    if (longSide === undefined && scale === undefined) throw new Error(`${where}: needs longSide or scale`);
    if (longSide !== undefined && scale !== undefined) throw new Error(`${where}: longSide and scale exclude each other`);
    if (longSide !== undefined && !(Number.isInteger(longSide) && (longSide as number) >= 1)) throw new Error(`${where}: longSide must be a positive integer`);
    if (scale !== undefined && !(typeof scale === 'number' && scale > 0 && scale <= 1)) throw new Error(`${where}: scale must be in (0, 1]`);
    return { kind: 'resize', id, from, ...(longSide !== undefined ? { longSide: longSide as number } : {}), ...(scale !== undefined ? { scale: scale as number } : {}) };
  }
  if (!Array.isArray(raw.steps)) throw new Error(legacy ? 'chain: steps must be an array' : `${where}: steps must be an array`);
  // A lifted v1 / v2 document keeps the messages parseChain gives.
  const steps = parseSteps(raw.steps, options, legacy ? (s) => `chain step ${s}` : (s) => `node "${id}" step ${s}`);
  return { kind: 'chain', id, from, steps, ...(raw.geometry !== undefined ? { geometry: parseGeometry(raw.geometry) } : {}) };
}

/** Each node after the nodes it reads; among the nodes that are ready, the first listed goes first. */
function sortNodes(listed: readonly GraphNode[], byId: ReadonlyMap<string, GraphNode>): GraphNode[] {
  const done = new Set<string>();
  const sorted: GraphNode[] = [];
  const ready = (n: GraphNode) => n.from.every((f) => !byId.has(f) || done.has(f));
  while (sorted.length < listed.length) {
    const next = listed.find((n) => !done.has(n.id) && ready(n));
    if (!next) throw new Error(`parseEdit: nodes ${describeCycle(listed.filter((n) => !done.has(n.id)), byId)} form a cycle`);
    done.add(next.id);
    sorted.push(next);
  }
  return sorted;
}

/** A cycle among nodes that could not be sorted, as "a → b → a" (each reads the next). */
function describeCycle(left: readonly GraphNode[], byId: ReadonlyMap<string, GraphNode>): string {
  const remaining = new Set(left.map((n) => n.id));
  const path: string[] = [];
  let at = left[0]!.id;
  while (!path.includes(at)) {
    path.push(at);
    at = byId.get(at)!.from.find((f) => remaining.has(f))!;
  }
  return [...path.slice(path.indexOf(at)), at].join(' → ');
}

/**
 * The steps of one chain node as a version 2 document: what a band worker parses again to run that
 * node (it cannot receive parsed steps: filters and LUTs are functions and objects of this thread).
 */
export function chainDocument(edit: unknown, nodeId: string): { readonly version: 2; readonly steps: readonly StepDocument[] } {
  const node = migrateEdit(edit).nodes.find((n) => n.id === nodeId);
  if (!node || (node.kind ?? 'chain') !== 'chain') throw new Error(`node "${nodeId}" is not a chain`);
  return { version: 2, steps: (node as { steps: readonly StepDocument[] }).steps };
}
