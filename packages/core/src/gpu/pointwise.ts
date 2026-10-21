import type { ParamSchema, ParamValues, PointwiseFilter } from '../filter';
import type { GpuContext } from './context';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

export function pointwiseShader(filter: PointwiseFilter): string {
  const fields = Object.keys(filter.params).map((k) => `  ${k}: f32,`);
  // WGSL forbids empty structs.
  if (fields.length === 0) fields.push('  _unused: f32,');
  return /* wgsl */ `
struct Params {
${fields.join('\n')}
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(2) var<uniform> params: Params;

${filter.wgsl}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(src);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, apply(textureLoad(src, id.xy, 0), params));
}
`;
}

const pipelines = new WeakMap<GPUDevice, Map<string, GPUComputePipeline>>();

function getPipeline(ctx: GpuContext, filter: PointwiseFilter): GPUComputePipeline {
  let cache = pipelines.get(ctx.device);
  if (!cache) pipelines.set(ctx.device, (cache = new Map()));
  let pipeline = cache.get(filter.id);
  if (!pipeline) {
    const module = ctx.device.createShaderModule({ label: filter.id, code: pointwiseShader(filter) });
    pipeline = ctx.device.createComputePipeline({ label: filter.id, layout: 'auto', compute: { module } });
    cache.set(filter.id, pipeline);
  }
  return pipeline;
}

/** Runs a pointwise filter on a working texture and returns a new working texture. */
export function runPointwise<S extends ParamSchema>(
  ctx: GpuContext,
  filter: PointwiseFilter<S>,
  input: GPUTexture,
  params: ParamValues<S>,
): GPUTexture {
  const { device } = ctx;
  const pipeline = getPipeline(ctx, filter as PointwiseFilter);
  const output = createWorkingTexture(ctx, input.width, input.height);

  const keys = Object.keys(filter.params);
  const values = new Float32Array(Math.max(4, Math.ceil(keys.length / 4) * 4));
  keys.forEach((k, i) => (values[i] = params[k]!));
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
