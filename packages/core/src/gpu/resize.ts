import type { GpuContext } from './context';
import { cachedPipeline } from './readback';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

/**
 * A tile of a downscale (#176): the output tile's top-left pixel and size, the top-left pixel of the
 * source rectangle it reads, and the whole source and output sizes.
 */
export interface DownscaleTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly srcX: number;
  readonly srcY: number;
  readonly srcWidth: number;
  readonly srcHeight: number;
  readonly fullWidth: number;
  readonly fullHeight: number;
}

/**
 * GPU twin of downscaleCpu: exact area average on linear premultiplied values. Returns a new texture,
 * `width` × `height`, or one tile of the result (`tile`: then `src` is the source rectangle it reads).
 */
export function downscale(ctx: GpuContext, src: GPUTexture, width: number, height: number, tile?: DownscaleTile): GPUTexture {
  const [sw, sh] = tile ? [tile.srcWidth, tile.srcHeight] : [src.width, src.height];
  const [fw, fh] = tile ? [tile.fullWidth, tile.fullHeight] : [width, height];
  if (fw > sw || fh > sh || fw < 1 || fh < 1) {
    throw new RangeError(`cannot downscale ${sw}x${sh} to ${fw}x${fh}`);
  }
  const pipeline = cachedPipeline(ctx, 'rullino.downscale', () => /* wgsl */ `
struct Scale { s: vec4f, at: vec4i, full: vec4i }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(2) var<uniform> scale: Scale;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let out = textureDimensions(dst);
  if (id.x >= out.x || id.y >= out.y) { return; }
  let size = vec2f(scale.full.xy);
  let o = vec2f(vec2i(id.xy) + scale.at.xy);
  let p0 = o * scale.s.xy;
  let p1 = min(size, (o + 1.0) * scale.s.xy);
  var acc = vec4f(0.0);
  for (var j = i32(floor(p0.y)); j < i32(ceil(p1.y)); j++) {
    let wy = min(p1.y, f32(j + 1)) - max(p0.y, f32(j));
    for (var i = i32(floor(p0.x)); i < i32(ceil(p1.x)); i++) {
      let wx = min(p1.x, f32(i + 1)) - max(p0.x, f32(i));
      acc += textureLoad(src, vec2i(i, j) - scale.at.zw, 0) * (wx * wy);
    }
  }
  textureStore(dst, id.xy, acc / (scale.s.x * scale.s.y));
}`);
  const out = createWorkingTexture(ctx, width, height);
  const uniforms = ctx.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new ArrayBuffer(48);
  new Float32Array(data, 0, 4).set([sw / fw, sh / fh, 0, 0]);
  new Int32Array(data, 16, 8).set([tile?.x ?? 0, tile?.y ?? 0, tile?.srcX ?? 0, tile?.srcY ?? 0, sw, sh, 0, 0]);
  ctx.device.queue.writeBuffer(uniforms, 0, data);
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
