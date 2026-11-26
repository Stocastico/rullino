import { defineFilter, srgbToLinear } from '@rullino/core';

// Tone mapping (#182): scene-referred light (HDR values far above 1, from OpenEXR, Radiance, gain
// maps or just an exposure push) to display-referred [0, 1]. The input is straight linear colour
// scaled by 2^ev; negative channels (colours outside sRGB) count as 0. Three curves:
//  - filmic: Narkowicz's fit of the ACES reference rendering, per channel (highlights desaturate, as
//    film does);
//  - reinhard: the extended operator on luminance, L' = L (1 + L / W²) / (1 + L), colour ratios kept
//    (a saturated highlight can still clip at 1 in one channel);
//  - log: AgX-like (the same idea, not AgX's matrices or polynomial): each channel's stops above or
//    below mid grey (0.18) are mapped onto 0..1 between a black and a white EV, through a logistic
//    sigmoid, to a display value (sRGB-encoded) that is turned back to linear light for the pipeline.

const LUMA = [0.2126, 0.7152, 0.0722] as const;
const MID = 0.18;

const filmic = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));

function logSigmoid(x: number, blackEv: number, whiteEv: number, contrast: number): number {
  const y = Math.min(1, Math.max(0, (Math.log2(Math.max(x, 1e-10) / MID) - blackEv) / (whiteEv - blackEv)));
  const y0 = -blackEv / (whiteEv - blackEv);
  const k = 10 * contrast;
  const l = (t: number) => 1 / (1 + Math.exp(-k * (t - y0)));
  return srgbToLinear((l(y) - l(0)) / (l(1) - l(0)));
}

export const toneMap = defineFilter({
  id: 'toneMap',
  label: 'Tone map',
  description: 'Squeezes very bright light (HDR files, or a big exposure push) into what a screen can show, keeping detail in the highlights instead of clipping them.',
  tryThis: 'Open an HDR file, or raise Exposure by 3 stops, then add this and compare the three methods.',
  preview: { ev: 2 },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    method: {
      type: 'enum',
      options: { filmic: 'Filmic (ACES)', reinhard: 'Reinhard', log: 'Log (AgX-like)' },
      default: 'filmic',
      label: 'Method',
      description: 'Filmic is punchy and desaturates highlights, Reinhard keeps colours in proportion, Log spreads a wide range of stops evenly.',
    },
    ev: { type: 'float', min: -5, max: 5, step: 0.05, default: 0, label: 'Exposure (EV)', description: 'Stops of light added before the curve: raise it to lift the shadows, lower it to save highlights.' },
    white: { type: 'float', min: 1, max: 64, step: 0.1, default: 8, label: 'White point', description: 'Reinhard only: the scene brightness (1 is paper white) that comes out as pure white.' },
    blackEv: { type: 'float', min: -16, max: -4, step: 0.1, default: -10, label: 'Black point (EV)', description: 'Log only: stops below mid grey that come out black.' },
    whiteEv: { type: 'float', min: 2, max: 12, step: 0.1, default: 6.5, label: 'White point (EV)', description: 'Log only: stops above mid grey that come out white.' },
    contrast: { type: 'float', min: 0.25, max: 3, step: 0.05, default: 1, label: 'Contrast', description: 'Log only: how steep the curve is through the midtones.' },
  },
  wgsl: /* wgsl */ `
fn tm_log(x: vec3f, p: Params) -> vec3f {
  let y = clamp((log2(max(x, vec3f(1e-10)) / 0.18) - p.blackEv) / (p.whiteEv - p.blackEv), vec3f(0.0), vec3f(1.0));
  let y0 = -p.blackEv / (p.whiteEv - p.blackEv);
  let k = 10.0 * p.contrast;
  let l0 = 1.0 / (1.0 + exp(k * y0));
  let l1 = 1.0 / (1.0 + exp(-k * (1.0 - y0)));
  let s = (1.0 / (1.0 + exp(-k * (y - vec3f(y0)))) - vec3f(l0)) / (l1 - l0);
  return rl_srgb_to_linear(s);
}

fn apply(c: vec4f, p: Params) -> vec4f {
  let v = max(c.rgb * exp2(p.ev), vec3f(0.0));
  var o: vec3f;
  if (p.method == 0u) {
    o = clamp((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  } else if (p.method == 1u) {
    let y = dot(v, vec3f(0.2126, 0.7152, 0.0722));
    let yo = y * (1.0 + y / (p.white * p.white)) / (1.0 + y);
    o = clamp(select(vec3f(0.0), v * (yo / y), y > 0.0), vec3f(0.0), vec3f(1.0));
  } else {
    o = tm_log(v, p);
  }
  return vec4f(o, c.a);
}`,
  pixel: ([r, g, b, a], p) => {
    const k = 2 ** p.ev;
    const v = [Math.max(r * k, 0), Math.max(g * k, 0), Math.max(b * k, 0)];
    let o: number[];
    if (p.method === 'filmic') o = v.map(filmic);
    else if (p.method === 'reinhard') {
      const y = LUMA[0] * v[0]! + LUMA[1] * v[1]! + LUMA[2] * v[2]!;
      const yo = (y * (1 + y / (p.white * p.white))) / (1 + y);
      o = v.map((x) => (y > 0 ? Math.min(1, Math.max(0, (x * yo) / y)) : 0));
    } else o = v.map((x) => logSigmoid(x, p.blackEv, p.whiteEv, p.contrast));
    return [o[0]!, o[1]!, o[2]!, a];
  },
  tolerance: { abs: 2e-4, rel: 2e-3 },
});

