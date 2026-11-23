// CPU reference for edit document v3 graphs (RFC #174, docs/design/edit-document-v3.md): each node
// in the order parseEdit sorted them, results dropped after their last reader. A v1 / v2 document
// (one chain node) renders bit for bit as `runChainCpu` on the framed image does.
import { applyGeometryCpu, isIdentityGeometry } from './geometry';
import type { EditGraph, GraphNode } from './graph';
import { createImage, type LinearImage } from './image';
import { blendMasked, createRasterMask, type Mask } from './mask';
import { runChainCpu } from './pipeline/chain';
import { downscaleCpu } from './resize';

export interface GraphCpuOptions {
  /**
   * Resolution of each input relative to its original (e.g. 0.25 for a preview): one number for
   * every input, or one per input name. Pixel-unit params use the scale of the input a node descends
   * from; after a `resize` they are pixels of the resized image, and the scale carries through.
   */
  readonly scale?: number | Readonly<Record<string, number>>;
  /** Use each filter's `fast` implementation where it has one. */
  readonly fast?: boolean;
}

/** One image for a one-input document, or the images by input name. */
export type GraphSources = LinearImage | Readonly<Record<string, LinearImage>>;

interface Rendered {
  readonly image: LinearImage;
  readonly scale: number;
}

const isImage = (x: unknown): x is LinearImage => typeof x === 'object' && x !== null && (x as LinearImage).data instanceof Float32Array && typeof (x as LinearImage).width === 'number';

/** Binds the sources to the graph's inputs, checking names; returns each input with its scale. */
export function bindSources(graph: EditGraph, sources: GraphSources, scale: GraphCpuOptions['scale'] = 1): Map<string, Rendered> {
  const needed = graph.inputs;
  const byName: Record<string, LinearImage> = isImage(sources)
    ? (() => {
        if (needed.length !== 1) throw new Error(`the document reads ${needed.length} inputs (${needed.join(', ')}): pass them by name`);
        return { [needed[0]!]: sources };
      })()
    : { ...sources };
  for (const name of Object.keys(byName))
    if (!needed.includes(name) && !graph.unused.includes(name)) throw new Error(`input "${name}" is not one the document reads (${needed.join(', ')})`);
  const out = new Map<string, Rendered>();
  for (const name of needed) {
    const image = byName[name];
    if (!image) throw new Error(`input "${name}" is missing`);
    const s = typeof scale === 'number' ? scale : (scale[name] ?? 1);
    out.set(name, { image, scale: s });
  }
  return out;
}

/** The size a `resize` node gives an image of `w`×`h` at `scale` (its original is `w/scale`×`h/scale`). */
export function resizeSize(node: Extract<GraphNode, { kind: 'resize' }>, w: number, h: number, scale: number): [number, number] {
  // The factor is decided on the original, so a preview shrinks in proportion to the full render;
  // at scale 1 this is exactly fitWithin(w, h, longSide), what output.longSide does.
  const k = node.longSide !== undefined ? Math.min(1, node.longSide / (Math.max(w, h) / scale)) : node.scale!;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Renders the graph's output node on the CPU (before `output.longSide`, which `applyEdit` applies). */
export function runGraphCpu(graph: EditGraph, sources: GraphSources, options: GraphCpuOptions = {}): LinearImage {
  const values = bindSources(graph, sources, options.scale);
  const inputs = new Set(values.keys());
  // How many nodes still read each value, so a result is dropped after its last reader.
  const readers = new Map<string, number>();
  for (const n of graph.nodes) for (const f of n.from) readers.set(f, (readers.get(f) ?? 0) + 1);
  const read = (name: string): Rendered => values.get(name)!;
  const done = (name: string) => {
    const left = readers.get(name)! - 1;
    readers.set(name, left);
    if (left === 0 && name !== graph.output.node && !inputs.has(name)) values.delete(name);
  };

  for (const node of graph.nodes) {
    const ins = node.from.map(read);
    values.set(node.id, renderNode(node, ins, options.fast ?? false));
    for (const f of node.from) done(f);
  }
  const out = values.get(graph.output.node)!.image;
  // Never hand back a source itself (nodes never change their inputs, but callers may).
  return [...inputs].some((name) => values.get(name)!.image === out) ? createImage(out.width, out.height, out.data.slice()) : out;
}

function renderNode(node: GraphNode, ins: readonly Rendered[], fast: boolean): Rendered {
  const [a, b] = ins as [Rendered, Rendered | undefined];
  switch (node.kind) {
    case 'chain': {
      const framed = node.geometry && !isIdentityGeometry(node.geometry) ? applyGeometryCpu(a.image, node.geometry) : a.image;
      return { image: runChainCpu(node.steps, framed, { scale: a.scale, fast }), scale: a.scale };
    }
    case 'resize': {
      const [w, h] = resizeSize(node, a.image.width, a.image.height, a.scale);
      const image = w === a.image.width && h === a.image.height ? a.image : downscaleCpu(a.image, w, h);
      return { image, scale: a.scale };
    }
    case 'mix': {
      checkMixSizes(node, a.image, b!.image);
      return { image: blendMasked(a.image, b!.image, mixMask(node)), scale: a.scale };
    }
  }
}

/** A constant mask of 1, for a mix without a mask (immutable; GPU textures are cached by identity). */
const EVERYWHERE = createRasterMask(1, 1, Float32Array.of(1));

/**
 * The mask a `mix` node blends with: its own mask (or 1 everywhere) with the amount folded into the
 * opacity, so CPU and GPU blend with the very same mask code (`blendMasked` / `blendMask`).
 */
export function mixMask(node: Extract<GraphNode, { kind: 'mix' }>): Mask {
  const m: Mask = node.mask ?? { kind: 'raster', raster: EVERYWHERE };
  return { ...m, opacity: (m.opacity ?? 1) * node.amount };
}

export function checkMixSizes(node: Extract<GraphNode, { kind: 'mix' }>, a: { width: number; height: number }, b: { width: number; height: number }): void {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`mix "${node.id}": its inputs are ${a.width}×${a.height} and ${b.width}×${b.height}; resize one of them first`);
}

/** A rendered value for {@link walkGraph}: what a node produced, at which scale, and how to free it. */
export interface GraphValue<T> {
  readonly value: T;
  readonly scale: number;
  /** Frees what this node made; called once no live node holds the value (never for inputs). */
  readonly free?: () => void;
}

/**
 * Walks a graph in order with any backend: `render` makes a node's value from its inputs' values.
 * A node may hand back one of its inputs' values unchanged (an empty chain, a resize to the same
 * size), so values are counted by identity: what a value holds is freed once no live node holds it
 * (inputs are never freed). Returns the output node's value; its `free` gives back what it holds.
 * Shared by the GPU executor and `applyEdit`'s CPU path.
 */
export async function walkGraph<T>(graph: EditGraph, inputs: ReadonlyMap<string, GraphValue<T>>, render: (node: GraphNode, ins: readonly GraphValue<T>[]) => GraphValue<T> | Promise<GraphValue<T>>): Promise<GraphValue<T>> {
  const values = new Map<string, GraphValue<T>>(inputs);
  const held = new Map<T, { holders: number; frees: (() => void)[] }>();
  for (const v of inputs.values()) held.set(v.value, { holders: Infinity, frees: [] });
  const release = (v: T) => {
    const h = held.get(v)!;
    if (--h.holders === 0) {
      held.delete(v);
      for (const f of h.frees) f();
    }
  };
  const readers = new Map<string, number>();
  for (const n of graph.nodes) for (const f of n.from) readers.set(f, (readers.get(f) ?? 0) + 1);
  try {
    for (const node of graph.nodes) {
      const r = await render(node, node.from.map((f) => values.get(f)!));
      const h = held.get(r.value);
      if (h) h.holders++;
      else held.set(r.value, { holders: 1, frees: [] });
      if (r.free) held.get(r.value)!.frees.push(r.free);
      values.set(node.id, { value: r.value, scale: r.scale });
      for (const f of node.from) {
        const left = readers.get(f)! - 1;
        readers.set(f, left);
        if (left === 0 && f !== graph.output.node && !inputs.has(f)) {
          release(values.get(f)!.value);
          values.delete(f);
        }
      }
    }
  } catch (e) {
    for (const [name, v] of values) if (!inputs.has(name)) release(v.value);
    throw e;
  }
  const out = values.get(graph.output.node)!;
  let freed = false;
  return { value: out.value, scale: out.scale, free: () => (freed ? undefined : ((freed = true), release(out.value))) };
}
