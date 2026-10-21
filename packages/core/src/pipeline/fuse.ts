// Fusion of consecutive pointwise filters into a single compute pass. Each filter's WGSL is
// namespaced (s<i>_) so helper names cannot collide, then one entry point threads the colour
// through every apply() in order, with each filter's own alpha convention.

import type { PointwiseFilter } from '../filter';
import { cachedPipeline } from '../gpu/readback';
import type { GpuContext } from '../gpu/context';
import { createWorkingTexture, WORKING_FORMAT } from '../gpu/texture';
import { packParams, paramsStructWgsl, resolveParams } from '../params';
import { colorWgsl } from '../wgsl';

const WORKGROUP = 8;

/**
 * Prefixes the names a filter declares at top level (fn, const, struct, alias, override; i.e. at
 * the start of a line) plus `Params`, and every use of them. Member accesses (`.y`) are left alone,
 * as are locals, which must therefore be declared indented, inside functions.
 */
export function namespaceWgsl(code: string, prefix: string): string {
  const names = new Set(['Params']);
  for (const m of code.matchAll(/^(?:fn|const|struct|alias|override)\s+([A-Za-z_]\w*)/gm)) names.add(m[1]!);
  let out = code;
  for (const name of names) out = out.replace(new RegExp(`(?<![.\\w])${name}(?!\\w)`, 'g'), `${prefix}${name}`);
  return out;
}

export function fusedShader(filters: readonly PointwiseFilter<any>[]): string {
  const decls: string[] = [];
  const fields: string[] = [];
  const calls: string[] = [];
  filters.forEach((f, i) => {
    const ns = `s${i}_`;
    decls.push(`// ${f.id}\n${paramsStructWgsl(`${ns}Params`, f.params)}\n${namespaceWgsl(f.wgsl, ns)}`);
    fields.push(`  @align(16) p${i}: ${ns}Params,`);
    calls.push(
      f.alpha === 'straight'
        ? `  c = rl_premultiply(${ns}apply(rl_unpremultiply(c), params.p${i}));`
        : `  c = ${ns}apply(c, params.p${i});`,
    );
  });
  return /* wgsl */ `
${colorWgsl}

${decls.join('\n\n')}

struct StageParams {
${fields.join('\n')}
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(2) var<uniform> params: StageParams;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(src);
  if (id.x >= size.x || id.y >= size.y) { return; }
  var c = textureLoad(src, id.xy, 0);
${calls.join('\n')}
  textureStore(dst, id.xy, c);
}
`;
}

/** Each filter's packed params, concatenated: every block is padded to 16 bytes, matching @align(16). */
function packStage(filters: readonly PointwiseFilter<any>[], params: readonly Record<string, unknown>[]): Uint8Array {
  const blocks = filters.map((f, i) => new Uint8Array(packParams(f.params, resolveParams(f.params, (params[i] ?? {}) as never))));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.byteLength, 0));
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.byteLength;
  }
  return out;
}

export interface FusedRun {
  readonly output: GPUTexture;
  /** True if this call had to compile a new shader. */
  readonly compiled: boolean;
}

/** Runs consecutive pointwise filters as one pass into a new working texture. */
export function runFused(
  ctx: GpuContext,
  filters: readonly PointwiseFilter<any>[],
  params: readonly Record<string, unknown>[],
  input: GPUTexture,
): FusedRun {
  const { device } = ctx;
  let compiled = false;
  // The shader depends only on which filters, in which order: slider moves reuse it.
  const key = `rullino.fused:${filters.map((f) => f.id).join(',')}`;
  const pipeline = cachedPipeline(ctx, key, () => {
    compiled = true;
    return fusedShader(filters);
  });
  const output = createWorkingTexture(ctx, input.width, input.height);
  const values = packStage(filters, params);
  const uniforms = device.createBuffer({ size: Math.max(16, values.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
  uniforms.destroy(); // deferred until the submitted work completes
  return { output, compiled };
}
