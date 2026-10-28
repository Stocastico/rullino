import type { LinearImage, Lut, Rgba8Image } from '@rullino/core';

/** An image as it crosses the worker boundary (its buffer is transferred): linear, or 8-bit pixels. */
export type ImageMessage = LinearImage | Rgba8Image;

/** Main thread -> worker: render `edit` on `image`. LUT names are resolved on the main thread. */
export interface RenderRequest {
  readonly id: number;
  readonly image: ImageMessage;
  readonly edit: unknown;
  readonly luts: Readonly<Record<string, Lut>>;
  readonly scale: number | undefined;
}

/** Worker -> main thread: the result, or the error's message. */
export type RenderResponse = { readonly id: number; readonly image: LinearImage } | { readonly id: number; readonly error: string };
