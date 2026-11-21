// Where a texture sits in the whole image (tiled rendering, #176). A tile is a rectangle of the image
// with a halo, rendered on a texture of its own: given its frame, passes see whole-image positions
// (`run(xy)` gets them, `load_<input>` takes them) and the whole image's size (`size()`), so a pixel
// far enough from the tile's edges comes out exactly as in a run on the whole image.
import type { GpuContext } from './context';

/** The tile's top-left pixel in the whole image, and the whole image's size. */
export interface TileFrame {
  readonly x: number;
  readonly y: number;
  readonly fullWidth: number;
  readonly fullHeight: number;
}

/** The frame of a texture that is the whole image. */
export const wholeFrame = (width: number, height: number): TileFrame => ({ x: 0, y: 0, fullWidth: width, fullHeight: height });

/** The frame as a 16-byte uniform buffer (`vec4i`: x, y, full width, full height). Destroy it after submitting. */
export function frameBuffer(ctx: GpuContext, frame: TileFrame): GPUBuffer {
  const buffer = ctx.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  ctx.device.queue.writeBuffer(buffer, 0, new Int32Array([frame.x, frame.y, frame.fullWidth, frame.fullHeight]));
  return buffer;
}
