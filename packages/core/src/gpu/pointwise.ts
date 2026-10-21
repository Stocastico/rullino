import type { PointwiseFilter } from '../filter';
import { packParams, paramsStructWgsl, resolveParams, type ParamSchema, type ParamValues } from '../params';
import { colorWgsl } from '../wgsl';
import type { GpuContext } from './context';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

export function pointwiseShader(filter: PointwiseFilter): string {
  const body =
    filter.alpha === 'straight'
      ? 'rl_premultiply(apply(rl_unpremultiply(c), params))'
      : 'apply(c, params)';
  return /* wgsl */ `
${paramsStructWgsl('Params', filter.params)}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(2) var<uniform> params: Params;

${colorWgsl}

${filter.wgsl}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(src);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = textureLoad(src, id.xy, 0);
  textureStore(dst, id.xy, ${body});
}
`;
}

const pipelines = new WeakMap<GPUDevice, WeakMap<PointwiseFilter, GPUComputePipeline>>();

function getPipeline(ctx: GpuContext, filter: PointwiseFilter): GPUComputePipeline {
  let cache = pipelines.get(ctx.device);
  if (!cache) pipelines.set(ctx.device, (cache = new WeakMap()));
  let pipeline = cache.get(filter);
  if (!pipeline) {
    const module = ctx.device.createShaderModule({ label: filter.id, code: pointwiseShader(filter) });
    pipeline = ctx.device.createComputePipeline({ label: filter.id, layout: 'auto', compute: { module } });
    cache.set(filter, pipeline);
  }
  return pipeline;
}

/** Runs a pointwise filter on a working texture and returns a new working texture. Missing params take defaults. */
export function runPointwise<S extends ParamSchema>(
  ctx: GpuContext,
  filter: PointwiseFilter<S>,
  input: GPUTexture,
  params?: Partial<ParamValues<S>>,
): GPUTexture {
  const { device } = ctx;
  const pipeline = getPipeline(ctx, filter as unknown as PointwiseFilter);
  const output = createWorkingTexture(ctx, input.width, input.height);

  const values = packParams(filter.params, resolveParams(filter.params, params));
  const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, values);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: input.createView() },
      { binding: 1, resource: output.createView() },
      { binding: 2, resource: { buffer: uniforms } },
    ],
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(input.width / WORKGROUP), Math.ceil(input.height / WORKGROUP));
  pass.end();
  device.queue.submit([enc.finish()]);
  uniforms.destroy(); // safe: destruction is deferred until submitted work completes
  return output;
}
