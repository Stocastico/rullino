import type { Mask, RasterMaskData } from '../mask';
import type { GpuContext } from './context';
import { cachedPipeline } from './readback';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

// WGSL twin of maskValue() in mask.ts: one shader per mask kind, parameters in a uniform block.
// a = (from, to) for linear, (center, radius) for radial; b = (feather, invert, opacity, 0).
const MASK_VALUE: Record<Mask['kind'], string> = {
  linear: /* wgsl */ `
  let a = mp.a.xy * s;
  let d = mp.a.zw * s - a;
  return mask_smoothstep(0.0, 1.0, dot(uv * s - a, d) / dot(d, d));`,
  radial: /* wgsl */ `
  let d = length((uv - mp.a.xy) * s / mp.a.zw);
  return 1.0 - mask_smoothstep(1.0 - mp.b.x, 1.0, d);`,
  raster: /* wgsl */ `
  let rs = vec2f(textureDimensions(raster));
  let p = clamp(uv * rs - 0.5, vec2f(0.0), rs - 1.0);
  let i0 = vec2i(floor(p));
  let i1 = min(i0 + 1, vec2i(rs) - 1);
  let f = p - floor(p);
  let v00 = textureLoad(raster, i0, 0).r;
  let v10 = textureLoad(raster, vec2i(i1.x, i0.y), 0).r;
  let v01 = textureLoad(raster, vec2i(i0.x, i1.y), 0).r;
  let v11 = textureLoad(raster, i1, 0).r;
  let top = v00 + (v10 - v00) * f.x;
  let bottom = v01 + (v11 - v01) * f.x;
  return top + (bottom - top) * f.y;`,
};

// 'blend' writes mix(src, flt, m); 'render' writes m itself to every channel.
type Mode = 'blend' | 'render';

const shader = (kind: Mask['kind'], mode: Mode) => /* wgsl */ `
struct MaskParams { a: vec4f, b: vec4f }
@group(0) @binding(0) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
${mode === 'blend' ? '@group(0) @binding(1) var src: texture_2d<f32>;\n@group(0) @binding(2) var flt: texture_2d<f32>;' : ''}
@group(0) @binding(3) var<uniform> mp: MaskParams;
${kind === 'raster' ? '@group(0) @binding(4) var raster: texture_2d<f32>;' : ''}

fn mask_smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
  if (e1 <= e0) { return select(1.0, 0.0, x < e0); }
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn mask_shape(uv: vec2f, s: vec2f) -> f32 {${MASK_VALUE[kind]}
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let fs = vec2f(size);
  var m = mask_shape((vec2f(id.xy) + 0.5) / fs, fs / max(fs.x, fs.y));
  if (mp.b.y > 0.5) { m = 1.0 - m; }
  m = m * mp.b.z;
${
  mode === 'blend'
    ? `  let c = textureLoad(src, id.xy, 0);
  textureStore(dst, id.xy, c + (textureLoad(flt, id.xy, 0) - c) * m);`
    : '  textureStore(dst, id.xy, vec4f(m));'
}
}`;

/**
 * Raster textures, most recently used last. Painting creates a new raster per pointer move, so
 * waiting for garbage collection would pile up GPU memory; the least recently used textures are
 * destroyed instead (the data stays in the raster object, so it can be uploaded again).
 */
const MAX_RASTER_TEXTURES = 4;
const rasters = new WeakMap<GPUDevice, Map<RasterMaskData, GPUTexture>>();

/** The raster as an r32float texture, uploaded once per object and device (rasters are immutable). */
function rasterTexture(ctx: GpuContext, r: RasterMaskData): GPUTexture {
  let lru = rasters.get(ctx.device);
  if (!lru) rasters.set(ctx.device, (lru = new Map()));
  let tex = lru.get(r);
  if (tex) {
    lru.delete(r);
  } else {
    tex = ctx.device.createTexture({ label: 'rullino.mask', size: [r.width, r.height], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    ctx.device.queue.writeTexture({ texture: tex }, r.data as Float32Array<ArrayBuffer>, { bytesPerRow: r.width * 4 }, [r.width, r.height]);
    // Destroying a texture that submitted work still reads is fine: the work completes first.
    for (const [old, t] of lru) {
      if (lru.size < MAX_RASTER_TEXTURES) break;
      t.destroy();
      lru.delete(old);
    }
  }
  lru.set(r, tex);
  return tex;
}

/** Raster mask textures currently alive on this device (for tests). */
export const rasterTextureCount = (ctx: GpuContext) => rasters.get(ctx.device)?.size ?? 0;

/** mix(input, filtered, mask) on the GPU (premultiplied, alpha included) into a new working texture. */
export function blendMask(ctx: GpuContext, input: GPUTexture, filtered: GPUTexture, mask: Mask): GPUTexture {
  return run(ctx, mask, input.width, input.height, [input, filtered]);
}

/** The mask as a w x h working texture with the mask value in every channel (input of mask-aware filters). */
export function renderMask(ctx: GpuContext, mask: Mask, w: number, h: number): GPUTexture {
  return run(ctx, mask, w, h);
}

function run(ctx: GpuContext, mask: Mask, width: number, height: number, blend?: [GPUTexture, GPUTexture]): GPUTexture {
  const { device } = ctx;
  const visibility = GPUShaderStage.COMPUTE;
  const mode: Mode = blend ? 'blend' : 'render';
  const pipeline = cachedPipeline(ctx, `rullino.mask:${mask.kind}:${mode}`, () => shader(mask.kind, mode), () => [
    { binding: 0, visibility, storageTexture: { access: 'write-only', format: WORKING_FORMAT } },
    ...(blend
      ? [
          { binding: 1, visibility, texture: { sampleType: 'unfilterable-float' as const } },
          { binding: 2, visibility, texture: { sampleType: 'unfilterable-float' as const } },
        ]
      : []),
    { binding: 3, visibility, buffer: { type: 'uniform' } },
    ...(mask.kind === 'raster' ? [{ binding: 4, visibility, texture: { sampleType: 'unfilterable-float' as const } }] : []),
  ]);
  const a = mask.kind === 'linear' ? [...mask.from, ...mask.to] : mask.kind === 'radial' ? [...mask.center, ...mask.radius] : [0, 0, 0, 0];
  const uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, new Float32Array([...a, mask.kind === 'radial' ? mask.feather : 0, mask.invert ? 1 : 0, mask.opacity ?? 1, 0]));
  const out = createWorkingTexture(ctx, width, height);
  const entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: out.createView() },
    ...(blend ? [{ binding: 1, resource: blend[0].createView() }, { binding: 2, resource: blend[1].createView() }] : []),
    { binding: 3, resource: { buffer: uniforms } },
  ];
  if (mask.kind === 'raster') entries.push({ binding: 4, resource: rasterTexture(ctx, mask.raster).createView() });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
  pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP), Math.ceil(height / WORKGROUP));
  pass.end();
  device.queue.submit([enc.finish()]);
  uniforms.destroy();
  return out;
}
