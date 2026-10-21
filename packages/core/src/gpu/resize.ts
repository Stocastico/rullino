import type { GpuContext } from './context';
import { cachedPipeline } from './readback';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

/** GPU twin of downscaleCpu: exact area average on linear premultiplied values. Returns a new texture. */
export function downscale(ctx: GpuContext, src: GPUTexture, width: number, height: number): GPUTexture {
  if (width > src.width || height > src.height || width < 1 || height < 1) {
    throw new RangeError(`cannot downscale ${src.width}x${src.height} to ${width}x${height}`);
  }
  const pipeline = cachedPipeline(ctx, 'rullino.downscale', () => /* wgsl */ `
struct Scale { s: vec2f }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(2) var<uniform> scale: Scale;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let out = textureDimensions(dst);
  if (id.x >= out.x || id.y >= out.y) { return; }
  let size = vec2f(textureDimensions(src));
  let p0 = vec2f(id.xy) * scale.s;
  let p1 = min(size, (vec2f(id.xy) + 1.0) * scale.s);
  var acc = vec4f(0.0);
  for (var j = i32(floor(p0.y)); j < i32(ceil(p1.y)); j++) {
    let wy = min(p1.y, f32(j + 1)) - max(p0.y, f32(j));
    for (var i = i32(floor(p0.x)); i < i32(ceil(p1.x)); i++) {
      let wx = min(p1.x, f32(i + 1)) - max(p0.x, f32(i));
      acc += textureLoad(src, vec2i(i, j), 0) * (wx * wy);
    }
  }
  textureStore(dst, id.xy, acc / (scale.s.x * scale.s.y));
}`);
  const out = createWorkingTexture(ctx, width, height);
  const uniforms = ctx.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  ctx.device.queue.writeBuffer(uniforms, 0, new Float32Array([src.width / width, src.height / height, 0, 0]));
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: out.createView() },
      { binding: 2, resource: { buffer: uniforms } },
    ],
  });
  const enc = ctx.device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP), Math.ceil(height / WORKGROUP));
  pass.end();
  ctx.device.queue.submit([enc.finish()]);
  uniforms.destroy();
  return out;
}
