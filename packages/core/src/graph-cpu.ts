// CPU reference for edit document v3 graphs (RFC #174, docs/design/edit-document-v3.md): each node
// in the order parseEdit sorted them, results dropped after their last reader. A v1 / v2 document
// (one chain node) renders bit for bit as `runChainCpu` on the framed image does.
import { applyGeometryCpu, isIdentityGeometry } from './geometry';
import type { EditGraph, GraphNode } from './graph';
import { createImage, type LinearImage } from './image';
import { maskImage } from './mask';
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
      const x = a.image;
      const y = b!.image;
      if (x.width !== y.width || x.height !== y.height) throw new Error(`mix "${node.id}": its inputs are ${x.width}×${x.height} and ${y.width}×${y.height}; resize one of them first`);
      const k = node.mask ? maskImage(node.mask, x.width, x.height) : undefined;
      const out = createImage(x.width, x.height);
      for (let i = 0; i < out.data.length; i++) out.data[i] = x.data[i]! + (y.data[i]! - x.data[i]!) * node.amount * (k ? k[i >> 2]! : 1);
      return { image: out, scale: a.scale };
    }
  }
}
