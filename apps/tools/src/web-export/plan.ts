// What the web-ready export does, as one edit document (version 3): shrink in linear light to the
// long side, then sharpen a little for the screen (output sharpening belongs after the resize, which
// is why this is a graph and not a v2 chain: v2 always shrinks last), then encode.

export type WebFormat = 'jpeg' | 'webp' | 'png';

export interface WebExportOptions {
  /** Long side in pixels; omitted keeps the size. Never enlarges. */
  readonly longSide?: number;
  /** Unsharp-mask amount after the shrink, 0 = none. */
  readonly sharpen: number;
  readonly format: WebFormat;
  /** 0..1, JPEG and WebP only. */
  readonly quality?: number;
}

/** Radius of the output sharpening, in pixels of the shrunk image: screen detail, not structure. */
export const SHARPEN_SIGMA = 0.6;

export function webExportEdit(o: WebExportOptions) {
  if (o.longSide !== undefined && !(Number.isInteger(o.longSide) && o.longSide > 0)) {
    throw new RangeError(`the long side must be a whole number of pixels above 0, not ${o.longSide}`);
  }
  const resize = o.longSide !== undefined ? [{ id: 'small', kind: 'resize' as const, from: 'photo', longSide: o.longSide }] : [];
  return {
    version: 3 as const,
    inputs: { photo: {} },
    nodes: [
      ...resize,
      {
        id: 'sharp',
        from: resize.length ? 'small' : 'photo',
        steps: o.sharpen > 0 ? [{ filter: 'unsharpMask', params: { amount: o.sharpen, sigma: SHARPEN_SIGMA } }] : [],
      },
    ],
    output: { node: 'sharp', format: o.format, ...(o.format !== 'png' && o.quality !== undefined && { quality: o.quality }) },
  };
}

const EXTENSIONS: Record<WebFormat, string> = { jpeg: 'jpg', webp: 'webp', png: 'png' };

/**
 * The name of a photo's export: its own name with the format's extension, made unique among `taken`
 * (compared without case, as on macOS and Windows), which it updates.
 */
export function outputName(input: string, format: WebFormat, taken: Set<string>): string {
  const dot = input.lastIndexOf('.');
  const stem = dot > 0 ? input.slice(0, dot) : input;
  const ext = EXTENSIONS[format];
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}.${ext}`;
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      return name;
    }
  }
}
