// GPU executor for edit document v3 graphs: a Pipeline per chain node (stages, fusion and masks as
// for v2), `mix` through the masked-step blend (`blendMask` with `mixMask`), `resize` through the
// linear-light `downscale`. Every texture it makes goes back to the pool once no node reads it.
import type { GpuContext } from './gpu/context';
import { applyGeometry } from './gpu/geometry';
import { blendMask } from './gpu/mask';
import { releaseTexture } from './gpu/pool';
import { downscale } from './gpu/resize';
import { isIdentityGeometry } from './geometry';
import type { EditGraph, GraphNode } from './graph';
import { checkMixSizes, mixMask, resizeSize, walkGraph, type GraphValue } from './graph-cpu';
import { Pipeline } from './pipeline/pipeline';

/** The output texture of a graph and how to give back what it holds (call once, after reading it). */
export interface GraphGpuResult {
  readonly texture: GPUTexture;
  readonly dispose: () => void;
}

/**
 * Renders the graph's output node (before `output.longSide`) on the GPU. `inputs` are working
 * textures by input name with their scale; they are not owned (the caller frees them).
 */
export async function runGraphGpu(ctx: GpuContext, graph: EditGraph, inputs: ReadonlyMap<string, { readonly texture: GPUTexture; readonly scale: number }>): Promise<GraphGpuResult> {
  const values = new Map<string, GraphValue<GPUTexture>>([...inputs].map(([name, v]) => [name, { value: v.texture, scale: v.scale }]));
  const out = await walkGraph(graph, values, (node, ins) => renderNode(ctx, node, ins));
  return { texture: out.value, dispose: () => out.free?.() };
}

function renderNode(ctx: GpuContext, node: GraphNode, ins: readonly GraphValue<GPUTexture>[]): GraphValue<GPUTexture> {
  const [a, b] = ins as [GraphValue<GPUTexture>, GraphValue<GPUTexture> | undefined];
  switch (node.kind) {
    case 'chain': {
      const framed = node.geometry && !isIdentityGeometry(node.geometry) ? applyGeometry(ctx, a.value, node.geometry) : undefined;
      const pipeline = new Pipeline(ctx);
      pipeline.setSource(framed ?? a.value, { scale: a.scale });
      const value = pipeline.run(node.steps);
      return {
        value,
        scale: a.scale,
        free: () => {
          pipeline.destroy();
          if (framed) releaseTexture(ctx, framed);
        },
      };
    }
    case 'resize': {
      const [w, h] = resizeSize(node, a.value.width, a.value.height, a.scale);
      if (w === a.value.width && h === a.value.height) return { value: a.value, scale: a.scale }; // borrowed: freed with its owner
      const value = downscale(ctx, a.value, w, h);
      return { value, scale: a.scale, free: () => releaseTexture(ctx, value) };
    }
    case 'mix': {
      checkMixSizes(node, a.value, b!.value);
      const value = blendMask(ctx, a.value, b!.value, mixMask(node));
      return { value, scale: a.scale, free: () => releaseTexture(ctx, value) };
    }
  }
}
