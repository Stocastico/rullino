import { geometryFrame, type Geometry } from '../geometry';
import type { GpuContext } from './context';
import { cachedPipeline } from './readback';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

// WGSL twin of applyGeometryCpu: the output -> source homography as three rows, then bilinear
// sampling of premultiplied values with texels outside the source treated as transparent.
const SHADER = /* wgsl */ `
struct Homography { r0: vec4f, r1: vec4f, r2: vec4f }
@group(0) @binding(0) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<uniform> m: Homography;

fn texel(p: vec2i) -> vec4f {
  let s = vec2i(textureDimensions(src));
  if (p.x < 0 || p.y < 0 || p.x >= s.x || p.y >= s.y) { return vec4f(0.0); }
  return textureLoad(src, p, 0);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let o = vec3f(vec2f(id.xy) + 0.5, 1.0);
  let q = vec3f(dot(m.r0.xyz, o), dot(m.r1.xyz, o), dot(m.r2.xyz, o));
  let pos = q.xy / q.z - 0.5;
  let base = floor(pos);
  let f = pos - base;
  let i = vec2i(base);
  let top = texel(i) + (texel(i + vec2i(1, 0)) - texel(i)) * f.x;
  let bottom = texel(i + vec2i(0, 1)) + (texel(i + vec2i(1, 1)) - texel(i + vec2i(0, 1))) * f.x;
  textureStore(dst, id.xy, top + (bottom - top) * f.y);
}`;

/** Resamples a working texture through `geometry` into a new working texture of the output size. */
export function applyGeometry(ctx: GpuContext, input: GPUTexture, geometry: Geometry): GPUTexture {
  const { device } = ctx;
  const frame = geometryFrame(geometry, input.width, input.height);
  const visibility = GPUShaderStage.COMPUTE;
  const pipeline = cachedPipeline(ctx, 'rullino.geometry', () => SHADER, () => [
    { binding: 0, visibility, storageTexture: { access: 'write-only', format: WORKING_FORMAT } },
    { binding: 1, visibility, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility, buffer: { type: 'uniform' } },
  ]);
  const m = frame.matrix;
  const uniforms = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0]));
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
