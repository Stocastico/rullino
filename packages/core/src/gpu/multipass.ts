import type { MultipassFilter, PassDef } from '../filter';
import { packParams, paramsStructWgsl, resolveParams, type ParamSchema } from '../params';
import { colorWgsl } from '../wgsl';
import type { GpuContext } from './context';
import { cachedPipeline } from './readback';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

export function passShader(params: ParamSchema, pass: PassDef): string {
  const inputs = pass.inputs.map(
    (name, i) => /* wgsl */ `
@group(0) @binding(${i + 2}) var tex_${name}: texture_2d<f32>;
fn load_${name}(xy: vec2i) -> vec4f {
  let s = vec2i(textureDimensions(tex_${name}));
  return textureLoad(tex_${name}, clamp(xy, vec2i(0), s - 1), 0);
}`,
  );
  return /* wgsl */ `
${paramsStructWgsl('Params', params)}

@group(0) @binding(0) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(1) var<uniform> params: Params;
${inputs.join('\n')}

fn size() -> vec2i { return vec2i(textureDimensions(dst)); }

${colorWgsl}

${pass.wgsl}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = textureDimensions(dst);
  if (id.x >= s.x || id.y >= s.y) { return; }
  textureStore(dst, id.xy, run(vec2i(id.xy), params));
}
`;
}

export interface FilterRun {
  readonly output: GPUTexture;
  readonly passes: number;
  readonly compiled: number;
}

/** Runs a multipass filter. `params` are used as given after resolving (scale them beforehand if needed). */
export function runMultipass(ctx: GpuContext, filter: MultipassFilter<any>, input: GPUTexture, params: Record<string, unknown>): FilterRun {
  const { device } = ctx;
  const values = packParams(filter.params, resolveParams(filter.params, params as never));
  const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, values);

  const textures = new Map<string, GPUTexture>([['input', input]]);
  let compiled = 0;
  const enc = device.createCommandEncoder();
  for (const pass of filter.passes) {
    const pipeline = cachedPipeline(ctx, `rullino.pass:${filter.id}:${pass.name}`, () => {
      compiled++;
      return passShader(filter.params, pass);
    });
    const out = createWorkingTexture(ctx, input.width, input.height);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: out.createView() },
        { binding: 1, resource: { buffer: uniforms } },
        ...pass.inputs.map((name, i) => ({ binding: i + 2, resource: textures.get(name)!.createView() })),
      ],
    });
    const cp = enc.beginComputePass();
    cp.setPipeline(pipeline);
    cp.setBindGroup(0, bindGroup);
    cp.dispatchWorkgroups(Math.ceil(input.width / WORKGROUP), Math.ceil(input.height / WORKGROUP));
    cp.end();
    textures.set(pass.name, out);
  }
  device.queue.submit([enc.finish()]);

  const output = textures.get(filter.passes.at(-1)!.name)!;
  // Intermediates are no longer needed once the work is submitted (destruction is deferred).
  for (const [name, t] of textures) if (name !== 'input' && t !== output) t.destroy();
  uniforms.destroy();
  return { output, passes: filter.passes.length, compiled };
}
