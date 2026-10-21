// Edges of the pipeline: 8-bit sRGB sources in, 8-bit sRGB out. Everything in between is
// linear premultiplied rgba16float (see texture.ts).

import { colorWgsl } from '../wgsl';
import type { GpuContext } from './context';
import { cachedPipeline, readTextureBytes } from './readback';
import { createWorkingTexture, WORKING_FORMAT } from './texture';

const WORKGROUP = 8;

const dispatch = (ctx: GpuContext, pipeline: GPUComputePipeline, entries: GPUBindGroupEntry[], w: number, h: number) => {
  const bindGroup = ctx.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const enc = ctx.device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(w / WORKGROUP), Math.ceil(h / WORKGROUP));
  pass.end();
  ctx.device.queue.submit([enc.finish()]);
};

// Duck-typed rather than instanceof: HTMLImageElement and friends do not exist in workers.
const sizeOf = (s: GPUCopyExternalImageSource): [number, number] =>
  'naturalWidth' in s ? [s.naturalWidth, s.naturalHeight]
  : 'videoWidth' in s ? [s.videoWidth, s.videoHeight]
  : 'displayWidth' in s ? [s.displayWidth, s.displayHeight]
  : [s.width, s.height];

/**
 * Uploads an 8-bit sRGB image (ImageBitmap, ImageData, canvas, <img>, ...) into a working texture.
 * The copy lands in an rgba8unorm-srgb texture, so sampling decodes sRGB in hardware; a compute
 * pass then premultiplies in linear light (premultiplying in sRGB space would be wrong).
 */
export function importImage(ctx: GpuContext, source: GPUCopyExternalImageSource): GPUTexture {
  const [width, height] = sizeOf(source);
  const staging = ctx.device.createTexture({
    size: { width, height },
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  ctx.device.queue.copyExternalImageToTexture({ source }, { texture: staging, premultipliedAlpha: false }, { width, height });

  const out = createWorkingTexture(ctx, width, height);
  const pipeline = cachedPipeline(ctx, 'rullino.import', () => /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<${WORKING_FORMAT}, write>;
${colorWgsl}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(src);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, rl_premultiply(textureLoad(src, id.xy, 0)));
}`);
  dispatch(ctx, pipeline, [
    { binding: 0, resource: staging.createView() },
    { binding: 1, resource: out.createView() },
  ], width, height);
  staging.destroy(); // deferred until the submitted work completes
  return out;
}

export interface EncodeOptions {
  /** 'premultiplied' suits a canvas configured with alphaMode 'premultiplied'; 'straight' suits ImageData / export. */
  readonly alpha: 'premultiplied' | 'straight';
}

/**
 * Encodes a working texture to 8-bit sRGB into `dst` (rgba8unorm with STORAGE_BINDING).
 * Colour is clamped to [0, 1] in linear light before encoding.
 */
export function encodeToTexture(ctx: GpuContext, src: GPUTexture, dst: GPUTexture, { alpha }: EncodeOptions): void {
  const premultiply = alpha === 'premultiplied';
  const pipeline = cachedPipeline(ctx, `rullino.encode.${alpha}`, () => /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
${colorWgsl}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(src);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = rl_unpremultiply(textureLoad(src, id.xy, 0));
  let a = clamp(c.a, 0.0, 1.0);
  let e = rl_linear_to_srgb(clamp(c.rgb, vec3f(0.0), vec3f(1.0)));
  textureStore(dst, id.xy, vec4f(${premultiply ? 'e * a' : 'e'}, a));
}`);
  dispatch(ctx, pipeline, [
    { binding: 0, resource: src.createView() },
    { binding: 1, resource: dst.createView() },
  ], src.width, src.height);
}

/** Reads a texture back as 8-bit sRGB, straight-alpha RGBA (ImageData layout). */
export async function readSrgb8(ctx: GpuContext, tex: GPUTexture): Promise<Uint8ClampedArray<ArrayBuffer>> {
  if (tex.format === 'rgba8unorm') return new Uint8ClampedArray(await readTextureBytes(ctx, tex, 4));
  const tmp = ctx.device.createTexture({
    size: { width: tex.width, height: tex.height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  encodeToTexture(ctx, tex, tmp, { alpha: 'straight' });
  const bytes = await readTextureBytes(ctx, tmp, 4);
  tmp.destroy();
  return new Uint8ClampedArray(bytes);
}
