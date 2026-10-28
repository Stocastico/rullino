// PixiJS v8 with pixi-filters on WebGL2: the image as a sprite, the chain as its filter list,
// rendered into a render texture and read back with extract.pixels (synchronous readPixels).
import { AdjustmentFilter, ColorMapFilter, ConvolutionFilter, OldFilmFilter } from 'pixi-filters';
import { autoDetectRenderer, BlurFilter, BufferImageSource, ColorMatrixFilter, RenderTexture, Sprite, Texture, type Filter, type Renderer } from 'pixi.js';
import type { Adapter } from '../adapter';
import { chainParams, type ChainId, type Variant } from '../chains';
import { versions } from '../versions';

let renderer: Renderer | undefined;
let sprite: Sprite | undefined;
let target: RenderTexture | undefined;
let colorMap: Texture | undefined;
let size = { width: 1, height: 1 };

function filtersFor(chain: ChainId, variant: Variant): Filter[] {
  const p = chainParams(chain, variant);
  switch (chain) {
    case 'exposure-curves-lut':
      // Exposure is a gain on linear light; AdjustmentFilter multiplies encoded values: 2^(ev / 2.2).
      return [new AdjustmentFilter({ brightness: 2 ** (p.ev! / 2.2) }), new ColorMapFilter({ colorMap: colorMap!, mix: 1 })];
    case 'blur-unsharp': {
      const a = p.amount!;
      // ConvolutionFilter's width / height are the image's (they set the texel size).
      return [new BlurFilter({ strength: p.sigma! * 2, quality: 4 }), new ConvolutionFilter({ matrix: [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0] as never, ...size })];
    }
    case 'levels-vignette-grain': {
      const k = 1 / (1 - p.inBlack!);
      const levels = new ColorMatrixFilter();
      levels.matrix = [k, 0, 0, 0, -p.inBlack! * k, 0, k, 0, 0, -p.inBlack! * k, 0, 0, k, 0, -p.inBlack! * k, 0, 0, 0, 1, 0];
      return [levels, new OldFilmFilter({ sepia: 0, scratch: 0, noise: p.grain! * 0.3, noiseSize: 1, vignetting: 0.5, vignettingAlpha: -p.vignette!, vignettingBlur: 0.5, seed: 0.5 })];
    }
  }
}

export const adapter: Adapter = {
  id: 'pixi',
  label: 'PixiJS + pixi-filters (WebGL2)',
  version: `${versions['pixi.js']} / pixi-filters ${versions['pixi-filters']}`,
  backend: 'WebGL2',
  notes: {
    'exposure-curves-lut': 'AdjustmentFilter brightness 2^(ev/2.2) (a gain on sRGB-encoded values, not linear light); curves and LUT baked together into one 32³ ColorMapFilter (computed by rullino) (no curve filter).',
    'blur-unsharp': 'BlurFilter strength 2σ, quality 4 (Pixi\'s own blur kernel, not a σ Gaussian); unsharp approximated by a 3×3 sharpen ConvolutionFilter (no unsharp mask).',
    'levels-vignette-grain': 'levels as a ColorMatrixFilter (offset + gain on sRGB values); vignette and grain from OldFilmFilter (no scratches, no sepia): a different vignette shape and noise.',
  },
  async init(tables) {
    renderer = await autoDetectRenderer({ preference: 'webgl', width: 16, height: 16, antialias: false, backgroundAlpha: 0 });
    const n = tables.colorMapSize;
    colorMap = new Texture({ source: new BufferImageSource({ resource: tables.colorMap, width: n * n, height: n }) });
  },
  async load(rgba, width, height) {
    sprite?.destroy({ texture: true, textureSource: true });
    target?.destroy(true);
    const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(rgba.buffer.slice(0)), width, height, alphaMode: 'no-premultiply-alpha' }) });
    sprite = new Sprite(texture);
    size = { width, height };
    target = RenderTexture.create({ width, height });
  },
  async run(chain, variant) {
    const old = sprite!.filters;
    sprite!.filters = filtersFor(chain, variant);
    for (const f of (old ?? []) as Filter[]) f.destroy();
    renderer!.render({ container: sprite!, target: target!, clear: true });
    return renderer!.extract.pixels(target!).pixels;
  },
  dispose() {
    sprite?.destroy({ texture: true, textureSource: true });
    target?.destroy(true);
    colorMap?.destroy(true);
    renderer?.destroy();
    [renderer, sprite, target, colorMap] = [undefined, undefined, undefined, undefined];
  },
};
