// wasm-vips (libvips compiled to WASM, multithreaded through Web Workers: the page must be
// cross-origin isolated). Images are lazy pipelines; writeToMemory() runs them.
import Vips from 'wasm-vips';
import wasmUrl from 'wasm-vips/vips.wasm?url';
import type { Adapter } from '../adapter';
import { chainParams } from '../chains';
import { versions } from '../versions';

type V = Awaited<ReturnType<typeof Vips>>;
let vips: V | undefined;
let source: InstanceType<V['Image']> | undefined;
let curve: Uint8Array | undefined;

export const adapter: Adapter = {
  id: 'vips',
  label: 'wasm-vips (WASM, threads)',
  version: versions['wasm-vips'],
  backend: 'WASM threads',
  notes: {
    'exposure-curves-lut': 'exposure as a gain in scRGB (linear light), the S-curve as a 256-entry maplut; no 3D LUT in libvips, so the LUT step is missing (less work than the others).',
    'blur-unsharp': 'gaussblur σ, then sharpen σ 2 (libvips\' LabS-based unsharp, its own response curve).',
    'levels-vignette-grain': 'levels as a linear gain + offset on sRGB values; vignette built from xyz (same smoothstep falloff, elliptical); grain as gaussnoise added to the encoded values (not midtone-weighted).',
  },
  async init(tables) {
    curve = tables.curve256;
    vips = await Vips({ dynamicLibraries: [], locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file) } as never);
  },
  async load(rgba, width, height) {
    source?.delete();
    source = vips!.Image.newFromMemory(new Uint8Array(rgba), width, height, 4, vips!.BandFormat.uchar);
  },
  async run(chain, variant) {
    const p = chainParams(chain, variant);
    const I = vips!.Image;
    const made: { delete(): void }[] = [];
    const t = <T extends { delete(): void }>(im: T) => (made.push(im), im);
    try {
      const { width: w, height: h } = source!;
      // extractBand makes a 'multiband' image; say it is sRGB so colour operations know their route.
      const rgb = t(t(source!.extractBand(0, { n: 3 })).copy({ interpretation: vips!.Interpretation.srgb }));
      const alpha = t(source!.extractBand(3));
      let out: InstanceType<V['Image']>;
      switch (chain) {
        case 'exposure-curves-lut': {
          const k = 2 ** p.ev!;
          const lit = t(t(t(rgb.colourspace('scrgb')).linear([k, k, k], [0, 0, 0])).colourspace('srgb'));
          const lut = t(I.newFromMemory(curve!, 256, 1, 1, vips!.BandFormat.uchar));
          out = t(lit.cast(vips!.BandFormat.uchar)).maplut(lut);
          break;
        }
        case 'blur-unsharp':
          out = t(t(rgb.gaussblur(p.sigma!)).sharpen({ sigma: p.sharpenSigma! })).colourspace(vips!.Interpretation.srgb);
          break;
        case 'levels-vignette-grain': {
          const k = 1 / (1 - p.inBlack!);
          const levelled = t(rgb.linear([k, k, k], [-255 * p.inBlack! * k, -255 * p.inBlack! * k, -255 * p.inBlack! * k]));
          // Vignette: normalised distance from the centre, smoothstep from 0.4 over 0.5, a gain.
          const xy = t(I.xyz(w, h));
          const q = t(xy.linear([2 / w, 2 / h], [1 / w - 1, 1 / h - 1]));
          const d = t(t(t(t(t(q.multiply(q)).bandmean()).linear(2, 0)).pow(0.5)).linear(1 / Math.SQRT2, 0));
          const clamped = t(t(d.linear(1 / 0.5, -0.4 / 0.5)).clamp({ min: 0, max: 1 }));
          const smooth = t(t(clamped.multiply(clamped)).multiply(t(clamped.linear(-2, 3))));
          const gain = t(smooth.linear(p.vignette!, 1));
          const noise = t(I.gaussnoise(w, h, { sigma: 255 * 0.2 * p.grain! * 0.5, mean: 0 }));
          out = t(t(levelled.multiply(gain)).add(noise));
          break;
        }
      }
      const rgba = t(t(out.cast(vips!.BandFormat.uchar)).bandjoin(alpha));
      return rgba.writeToMemory();
    } finally {
      for (const im of made) im.delete();
    }
  },
  dispose() {
    source?.delete();
    vips?.shutdown();
    [vips, source] = [undefined, undefined];
  },
};
