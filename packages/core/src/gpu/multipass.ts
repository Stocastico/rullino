import type { MultipassFilter, PassDef } from '../filter';
import { imageSamplerWgsl, type LinearImage } from '../image';
import { lutSamplerWgsl, type Lut } from '../lut';
import { curveSamplersWgsl, packParams, paramsStructWgsl, resolveParams, type ParamSchema } from '../params';
import { colorWgsl } from '../wgsl';
import type { GpuContext } from './context';
import { imageTexture } from './image';
import { lutTexture } from './lut';
import { cachedPipeline, objectKey } from './readback';
import { releaseTexture } from './pool';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

const keysOf = (type: 'lut' | 'image') => (schema: ParamSchema) => Object.keys(schema).filter((k) => schema[k]!.type === type);
const lutKeys = keysOf('lut');
const imageKeys = keysOf('image');

export function passShader(filter: Pick<MultipassFilter<any>, 'params' | 'buffers'>, pass: PassDef): string {
  const compute = pass.kind === 'compute';
  // Bindings: [dst], params, inputs..., buffers..., luts..., images...
  let binding = compute ? 0 : 1;
  const params = `@group(0) @binding(${binding++}) var<uniform> params: Params;`;
  const inputs = pass.inputs.map(
    (name) => /* wgsl */ `
@group(0) @binding(${binding++}) var tex_${name}: texture_2d<f32>;
fn load_${name}(xy: vec2i) -> vec4f {
  return textureLoad(tex_${name}, clamp(xy, vec2i(0), rl_max_xy), 0);
}`,
  );
  const buffers = (pass.buffers ?? []).map(
    (name) => `@group(0) @binding(${binding++}) var<storage, read_write> buf_${name}: array<atomic<u32>, ${filter.buffers![name]}>;`,
  );
  const luts = lutKeys(filter.params).map(
    (name) => `@group(0) @binding(${binding++}) var lutTex_${name}: texture_3d<f32>;${lutSamplerWgsl(`lut_${name}`, `lutTex_${name}`, `params.${name}`)}`,
  );
  const images = imageKeys(filter.params).map(
    (name) => `@group(0) @binding(${binding++}) var imageTex_${name}: texture_2d<f32>;${imageSamplerWgsl(`image_${name}`, `imageTex_${name}`)}`,
  );
  // All textures of a filter run share one size; it is read once per invocation into rl_max_xy
  // instead of calling textureDimensions() on every load.
  const sizeSource = compute ? `tex_${pass.inputs[0]}` : 'dst';
  const head = /* wgsl */ `
var<private> rl_max_xy: vec2i;
${paramsStructWgsl('Params', filter.params)}
${compute ? '' : `@group(0) @binding(0) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;`}
${params}
${inputs.join('\n')}
${buffers.join('\n')}
${luts.join('\n')}
${images.join('\n')}

fn size() -> vec2i { return rl_max_xy + 1; }
${curveSamplersWgsl(filter.params, 'params')}

${colorWgsl}

${pass.wgsl}
`;
  if (!compute) {
    return `${head}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let s = textureDimensions(dst);
  if (id.x >= s.x || id.y >= s.y) { return; }
  rl_max_xy = vec2i(s) - 1;
  textureStore(dst, id.xy, run(vec2i(id.xy), params));
}
`;
  }
  if (pass.dispatch === 'single') {
    return `${head}
@compute @workgroup_size(1)
fn main() {
  rl_max_xy = vec2i(textureDimensions(${sizeSource})) - 1;
  run(vec2i(0), params);
}
`;
  }
  return `${head}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  rl_max_xy = vec2i(textureDimensions(${sizeSource})) - 1;
  if (i32(id.x) > rl_max_xy.x || i32(id.y) > rl_max_xy.y) { return; }
  run(vec2i(id.xy), params);
}
`;
}

/** Bind group layout matching {@link passShader}: [dst], params, inputs..., buffers..., luts..., images... */
function passLayout(filter: Pick<MultipassFilter<any>, 'params'>, pass: PassDef): GPUBindGroupLayoutEntry[] {
  const visibility = GPUShaderStage.COMPUTE;
  const entries: GPUBindGroupLayoutEntry[] = [];
  if (pass.kind !== 'compute') {
    entries.push({ binding: 0, visibility, storageTexture: { access: 'write-only', format: WORKING_FORMAT } });
  }
  entries.push({ binding: entries.length, visibility, buffer: { type: 'uniform' } });
  for (const _ of pass.inputs) entries.push({ binding: entries.length, visibility, texture: { sampleType: 'unfilterable-float' } });
  for (const _ of pass.buffers ?? []) entries.push({ binding: entries.length, visibility, buffer: { type: 'storage' } });
  for (const _ of lutKeys(filter.params))
    entries.push({ binding: entries.length, visibility, texture: { sampleType: 'unfilterable-float', viewDimension: '3d' } });
  for (const _ of imageKeys(filter.params)) entries.push({ binding: entries.length, visibility, texture: { sampleType: 'unfilterable-float' } });
  return entries;
}

export interface FilterRun {
  readonly output: GPUTexture;
  readonly passes: number;
  readonly compiled: number;
}

/**
 * Runs a multipass filter. `params` are used as given after resolving (scale them beforehand if
 * needed). `mask` (see `renderMask`) is required by mask-aware filters and is not owned.
 */
export function runMultipass(ctx: GpuContext, filter: MultipassFilter<any>, input: GPUTexture, params: Record<string, unknown>, mask?: GPUTexture): FilterRun {
  const { device } = ctx;
  if (filter.usesMask && !mask) throw new Error(`filter "${filter.id}" needs a mask`);
  const resolved = resolveParams(filter.params, params as never) as Record<string, unknown>;
  const values = packParams(filter.params, resolved as never);
  const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, values);

  const textures = new Map<string, GPUTexture>([['input', input]]);
  if (filter.usesMask) textures.set('mask', mask!);
  const owned = new Set<GPUTexture>();
  // Freshly created buffers are zero-filled, which is the reset reductions need.
  const buffers = new Map(
    Object.entries(filter.buffers ?? {}).map(([name, n]) => [name, device.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE })]),
  );
  const lutViews = lutKeys(filter.params).map((k) => lutTexture(ctx, resolved[k] as Lut).createView());
  const imageViews = imageKeys(filter.params).map((k) => imageTexture(ctx, resolved[k] as LinearImage).createView());
  let compiled = 0;
  let passes = 0;
  const enc = device.createCommandEncoder();
  const dispatch = (pipeline: GPUComputePipeline, entries: GPUBindGroupEntry[], x: number, y: number) => {
    const cp = enc.beginComputePass();
    cp.setPipeline(pipeline);
    cp.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
    cp.dispatchWorkgroups(x, y);
    cp.end();
    passes++;
  };
  for (const pass of filter.passes) {
    const pipeline = cachedPipeline(
      ctx,
      `rullino.pass:${filter.id}#${objectKey(filter)}:${pass.name}`,
      () => {
        compiled++;
        return passShader(filter, pass);
      },
      () => passLayout(filter, pass),
    );
    // Buffers, then LUT and image textures, after the inputs.
    const bufferEntries = (first: number): GPUBindGroupEntry[] => [
      ...(pass.buffers ?? []).map((name, i) => ({ binding: first + i, resource: { buffer: buffers.get(name)! } })),
      ...[...lutViews, ...imageViews].map((view, i) => ({ binding: first + (pass.buffers ?? []).length + i, resource: view })),
    ];

    if (pass.kind === 'compute') {
      const inputs = pass.inputs.map((name, i) => ({ binding: 1 + i, resource: textures.get(name)!.createView() }));
      const [x, y] = pass.dispatch === 'single' ? [1, 1] : [Math.ceil(input.width / WORKGROUP), Math.ceil(input.height / WORKGROUP)];
      dispatch(pipeline, [{ binding: 0, resource: { buffer: uniforms } }, ...inputs, ...bufferEntries(1 + inputs.length)], x, y);
      continue;
    }

    const iterations = pass.repeat === undefined ? 1 : Math.max(0, resolved[pass.repeat] as number);
    let result = textures.get(pass.inputs[0]!)!;
    if (iterations === 0 && result === input) {
      // Never hand back the caller's input as our output: copy it.
      result = createWorkingTexture(ctx, input.width, input.height);
      enc.copyTextureToTexture({ texture: input }, { texture: result }, [input.width, input.height]);
      owned.add(result);
    }
    // Repeated passes ping-pong between two textures: allocating (and lazily zeroing) a fresh
    // texture per iteration dominated the cost of long repeats such as Canny's hysteresis.
    const pingPong: GPUTexture[] = [];
    for (let it = 0; it < iterations; it++) {
      let out = pingPong[it % 2];
      if (!out) {
        out = createWorkingTexture(ctx, input.width, input.height);
        owned.add(out);
        pingPong.push(out);
      }
      const sources = pass.inputs.map((name, i) => (i === 0 && it > 0 ? result : textures.get(name)!));
      dispatch(
        pipeline,
        [
          { binding: 0, resource: out.createView() },
          { binding: 1, resource: { buffer: uniforms } },
          ...sources.map((t, i) => ({ binding: i + 2, resource: t.createView() })),
          ...bufferEntries(2 + sources.length),
        ],
        Math.ceil(input.width / WORKGROUP),
        Math.ceil(input.height / WORKGROUP),
      );
      result = out;
    }
    textures.set(pass.name, result);
  }
  device.queue.submit([enc.finish()]);

  const output = textures.get(filter.passes.at(-1)!.name)!;
  // Intermediates go back to the pool once the work that reads them is submitted.
  for (const t of owned) if (t !== output) releaseTexture(ctx, t);
  for (const b of buffers.values()) b.destroy();
  uniforms.destroy();
  return { output, passes, compiled };
}
