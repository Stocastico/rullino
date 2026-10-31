import type { LinearImage, Lut, Rgba8Image } from '@rullino/core';
import type { BandPlan } from '@rullino/core/internal';

/** An image as it crosses the worker boundary (its buffer is transferred): linear, or 8-bit pixels. */
export type ImageMessage = LinearImage | Rgba8Image;

/** Main thread -> worker: render `edit` on `image`. LUT names are resolved on the main thread. */
export interface RenderRequest {
  readonly id: number;
  readonly image: ImageMessage;
  readonly edit: unknown;
  readonly luts: Readonly<Record<string, Lut>>;
  readonly scale: number | undefined;
  /** Answer with 8-bit pixels (encoded in the worker) instead of a linear image. */
  readonly pixels: boolean;
  /** CPU threads for this renderer (constant over its life): 1 renders in this worker alone. */
  readonly threads: number;
  readonly pool: PoolOptions | undefined;
}

/** Advanced options of the band workers (bundlers, tests, diagnostics). */
export interface PoolOptions {
  /** An image of at least this many pixels starts the pool when there is none. Default 2 MP. */
  readonly createAtPixels?: number;
  /** An existing pool is used from this many pixels. Default 0.5 MP. */
  readonly useAtPixels?: number;
  /** Cut into the requested number of bands whatever the halo (tests); normally a band is at least 4 × halo rows. */
  readonly forceBands?: boolean;
  /** Share the image with the band workers instead of copying bands: `true` needs cross-origin isolation. Default false: measured no faster than copies. */
  readonly shared?: boolean;
  /** Where the band worker script is; default: next to this one. */
  readonly workerUrl?: string | URL;
  /** Called with the number of band jobs each render ran (0 when it stayed in one thread). */
  readonly onRender?: (info: { readonly bands: number; readonly shared: boolean }) => void;
}

/** Coordinator -> band worker: one band of one segment. */
export interface BandJob {
  readonly type: 'band';
  readonly edit: unknown;
  readonly luts: Readonly<Record<string, Lut>>;
  /** Which render and segment this is, so a worker parses a document once for all its bands. */
  readonly key: number;
  readonly scale: number;
  /** The segment's steps: indices into the enabled steps of the document. */
  readonly from: number;
  readonly to: number;
  readonly width: number;
  readonly height: number;
  readonly band: BandPlan;
  /** Copy path: the band's input rows (transferred). Shared path: the whole source and output. */
  readonly rows?: Float32Array;
  readonly src?: SharedArrayBuffer;
  readonly dst?: SharedArrayBuffer;
}

/** Band worker -> coordinator. */
export type BandReply = { readonly type: 'ready' } | { readonly type: 'done'; readonly rows?: Float32Array } | { readonly type: 'error'; readonly message: string };

/** Worker -> main thread: the result, or the error's message. */
export type RenderResponse = { readonly id: number; readonly image: ImageMessage; readonly bands: number; readonly shared: boolean } | { readonly id: number; readonly error: string };
