import { geometryFrame, type Geometry } from '../geometry';
import type { GpuContext } from './context';
import { cachedPipeline } from './readback';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

// WGSL twin of applyGeometryCpu: the output -> source homography as three rows, then bilinear
// sampling of premultiplied values with texels outside the source treated as transparent. In tiles
// (#176), `at` = (output x, output y, source x, source y) of the textures' top-left pixels in the
// whole images and `full` = the whole source's size: zero offsets and the texture's size otherwise.
const SHADER = /* wgsl */ `
struct Homography { r0: vec4f, r1: vec4f, r2: vec4f, at: vec4i, full: vec4i }
@group(0) @binding(0) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<uniform> m: Homography;

fn texel(p: vec2i) -> vec4f {
  let s = m.full.xy;
  if (p.x < 0 || p.y < 0 || p.x >= s.x || p.y >= s.y) { return vec4f(0.0); }
  return textureLoad(src, clamp(p - m.at.zw, vec2i(0), vec2i(textureDimensions(src)) - 1), 0);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let o = vec3f(vec2f(vec2i(id.xy) + m.at.xy) + 0.5, 1.0);
  let q = vec3f(dot(m.r0.xyz, o), dot(m.r1.xyz, o), dot(m.r2.xyz, o));
  let pos = q.xy / q.z - 0.5;
  let base = floor(pos);
  let f = pos - base;
  let i = vec2i(base);
  let top = texel(i) + (texel(i + vec2i(1, 0)) - texel(i)) * f.x;
  let bottom = texel(i + vec2i(0, 1)) + (texel(i + vec2i(1, 1)) - texel(i + vec2i(0, 1))) * f.x;
  textureStore(dst, id.xy, top + (bottom - top) * f.y);
}`;

/**
 * Where a tile of a geometry's output and the source rectangle it reads sit in the whole images: the
 * output tile's top-left pixel and size, the source texture's top-left pixel, the whole source's size.
 */
export interface GeometryTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly srcX: number;
  readonly srcY: number;
  readonly srcWidth: number;
  readonly srcHeight: number;
}

/**
 * Resamples a working texture through `geometry` into a new working texture of the output size, or
 * of one tile of it (`tile`: then `input` is the source rectangle the tile reads).
 */
export function applyGeometry(ctx: GpuContext, input: GPUTexture, geometry: Geometry, tile?: GeometryTile): GPUTexture {
  const { device } = ctx;
  const whole = geometryFrame(geometry, tile?.srcWidth ?? input.width, tile?.srcHeight ?? input.height);
  const frame = tile ? { ...whole, width: tile.width, height: tile.height } : whole;
  const visibility = GPUShaderStage.COMPUTE;
  const pipeline = cachedPipeline(ctx, 'rullino.geometry', () => SHADER, () => [
    { binding: 0, visibility, storageTexture: { access: 'write-only', format: WORKING_FORMAT } },
    { binding: 1, visibility, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility, buffer: { type: 'uniform' } },
  ]);
  const m = frame.matrix;
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new ArrayBuffer(80);
  new Float32Array(data, 0, 12).set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0]);
  new Int32Array(data, 48, 8).set([tile?.x ?? 0, tile?.y ?? 0, tile?.srcX ?? 0, tile?.srcY ?? 0, tile?.srcWidth ?? input.width, tile?.srcHeight ?? input.height, 0, 0]);
  device.queue.writeBuffer(uniforms, 0, data);
  const out = createWorkingTexture(ctx, frame.width, frame.height);
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: out.createView() },
        { binding: 1, resource: input.createView() },
        { binding: 2, resource: { buffer: uniforms } },
      ],
    }),
  );
  pass.dispatchWorkgroups(Math.ceil(frame.width / WORKGROUP), Math.ceil(frame.height / WORKGROUP));
  pass.end();
  device.queue.submit([enc.finish()]);
  uniforms.destroy();
  return out;
}
