// Photon (Rust compiled to WASM, single-threaded, 8-bit sRGB): every run copies the source into a
// fresh PhotonImage (its operations work in place) and copies the result out.
import init, { adjust_brightness, adjust_contrast, dec_brightness, filter, gaussian_blur, PhotonImage, sharpen } from '@silvia-odwyer/photon';
import wasmUrl from '@silvia-odwyer/photon/photon_rs_bg.wasm?url';
import type { Adapter } from '../adapter';
import { chainParams } from '../chains';
import { versions } from '../versions';

let source: { rgba: Uint8Array; width: number; height: number } | undefined;

export const adapter: Adapter = {
  id: 'photon',
  label: 'Photon (WASM)',
  version: versions['@silvia-odwyer/photon'],
  backend: 'WASM',
  notes: {
    'exposure-curves-lut': 'adjust_brightness (adds to 8-bit values) for exposure, adjust_contrast for the curve, the "golden" preset in place of the LUT: Photon has no curves and no LUTs.',
    'blur-unsharp': 'gaussian_blur radius round(σ); sharpen is a fixed 3×3 kernel (no unsharp mask, no amount or radius).',
    'levels-vignette-grain': 'dec_brightness by the black point for levels (no stretch) and nothing else: Photon has no levels or vignette, and its noise functions (add_noise_rand, pink_noise) trap in WASM in 0.3.3 ("unreachable"), so this chain does much less work than the others.',
  },
  async init() {
    await init({ module_or_path: wasmUrl });
  },
  async load(rgba, width, height) {
    source = { rgba: new Uint8Array(rgba), width, height };
  },
  async run(chain, variant) {
    const p = chainParams(chain, variant);
    const img = new PhotonImage(source!.rgba.slice(), source!.width, source!.height);
    try {
      switch (chain) {
        case 'exposure-curves-lut':
          adjust_brightness(img, Math.round(255 * (2 ** (p.ev! / 2.2) - 1) * 0.5));
          adjust_contrast(img, 15);
          filter(img, 'golden');
          break;
        case 'blur-unsharp':
          gaussian_blur(img, Math.round(p.sigma!));
          sharpen(img);
          break;
        case 'levels-vignette-grain':
          dec_brightness(img, Math.round(255 * p.inBlack!));
          break;
      }
      return img.get_raw_pixels();
    } finally {
      img.free();
    }
  },
  dispose() {
    source = undefined;
  },
};
