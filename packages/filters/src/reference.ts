import type { Filter, FilterCategory, Param, ParamSchema } from '@rullino/core';

// The filter reference (docs/filters.md), generated from the filters' own schemas so it cannot
// drift: a test compares it with the committed file. Not part of the public API.

const CATEGORIES: readonly [FilterCategory, string][] = [
  ['adjust', 'Adjust'],
  ['look', 'Look'],
  ['classic', 'Classic'],
  ['stylize', 'Stylize'],
];

const num = (n: number) => (n < 0 ? `−${-n}` : String(n));
const cell = (s: string) => s.replace(/\|/g, '\\|');
const PIXELS = ', in pixels of the full-resolution image';
const hex = (c: readonly number[]) => `#${c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;

/** [type, range or options, default] of a param, as table cells. */
function describe(p: Param): [string, string, string] {
  switch (p.type) {
    case 'float':
      return ['number', `${num(p.min)} … ${num(p.max)} (step ${p.step})${p.unit === 'px' ? PIXELS : ''}`, num(p.default)];
    case 'int':
      return ['integer', `${num(p.min)} … ${num(p.max)}${p.unit === 'px' ? PIXELS : ''}`, num(p.default)];
    case 'bool':
      return ['on / off', '', p.default ? 'on' : 'off'];
    case 'enum':
      return ['choice', Object.entries(p.options).map(([k, label]) => `\`${k}\` ${label}`).join(', '), `\`${p.default}\``];
    case 'kernel':
      return [`${p.size}×${p.size} matrix`, `${p.size * p.size} values`, p.default.every((v) => v === p.default[0]) ? `all ${num(p.default[0] ?? 0)}` : `${p.default.length} values`];
    case 'curve':
      return ['tone curve', '2 to 16 points in [0, 1]', p.default.map(([x, y]) => `(${x}, ${y})`).join(' ')];
    case 'lut':
      return ['3D LUT', '`.cube` or HaldCLUT file', 'none'];
    case 'image':
      return ['image', 'an image set by the app, not serialisable', 'none'];
    case 'color':
      return ['colour', 'sRGB colour', hex(p.default)];
  }
}

function section(f: Filter<any>): string {
  const kind =
    f.kind === 'pointwise'
      ? `Pointwise, ${f.alpha} alpha`
      : `Multipass (${f.passes.length} pass${f.passes.length === 1 ? '' : 'es'})${f.usesMask ? ', needs a mask' : ''}`;
  const params = Object.entries(f.params as ParamSchema);
  const grouped = params.some(([, p]) => p.group);
  const lines = [`### ${f.label} (\`${f.id}\`)`, '', `${kind}.`, ''];
  if (f.description) lines.push(f.description, '');
  if (f.tryThis) lines.push(`**Try this:** ${f.tryThis}`, '');
  if (params.length === 0) return `${lines.join('\n')}No parameters.\n`;
  const noted = params.some(([, p]) => p.description);
  lines.push(
    `| Parameter | Label | Type | Range / options | Default |${grouped ? ' Group |' : ''}${noted ? ' Notes |' : ''}`,
    `|---|---|---|---|---|${grouped ? '---|' : ''}${noted ? '---|' : ''}`,
  );
  for (const [key, p] of params) {
    const [type, range, def] = describe(p);
    const name = p.label ?? key;
    const label = 'unit' in p && p.unit === 'px' && !name.includes('px') ? `${name} (px)` : name;
    lines.push(`| \`${key}\` | ${cell(label)} | ${type} | ${cell(range)} | ${cell(def)} |${grouped ? ` ${p.group ?? ''} |` : ''}${noted ? ` ${cell(p.description ?? '')} |` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The whole reference as markdown: filters grouped by category, one table of params each. */
export function filterReference(filters: readonly Filter<any>[]): string {
  const out = [
    '# Filter reference',
    '',
    `${filters.length} filter${filters.length === 1 ? '' : 's'}. Generated from the filters' schemas (\`packages/filters\`): do not edit by hand; \`npx vitest run packages/filters -u\` rewrites it. Every filter has a WGSL (GPU) and a TypeScript (CPU) implementation, and the tests check that they agree. Pixel lengths are given for the full-resolution image and scale with previews.`,
    '',
  ];
  for (const [category, title] of CATEGORIES) {
    const group = filters.filter((f) => f.category === category);
    if (group.length === 0) continue;
    out.push(`## ${title} (${group.length})`, '');
    for (const f of group) out.push(section(f));
  }
  return `${out.join('\n').trimEnd()}\n`;
}

const short = (n: number) => String(Number(n.toPrecision(3)));

/**
 * The parity table (docs/parity.md): how far each filter's GPU output may be from its CPU
 * reference, straight from the tolerances the parity tests use.
 */
export function parityTable(filters: readonly Filter<any>[]): string {
  const out = [
    '# GPU ↔ CPU parity',
    '',
    `${filters.length} filter${filters.length === 1 ? '' : 's'}. Generated from the filters' tolerances (\`packages/filters\`): do not edit by hand; \`npx vitest run packages/filters -u\` rewrites it.`,
    '',
    'Every filter has two implementations: a WGSL compute shader (GPU) and a plain TypeScript reference (CPU), which is the specification. They do not produce identical numbers (the GPU keeps intermediate images in float16 and its maths functions differ slightly), so each filter declares how far apart they may be, and CI checks it on every change. This table is that declaration.',
    '',
    '**What is checked.** For every channel of every pixel, in linear light (0 = black, 1 = white, values above 1 are HDR): `|gpu − cpu| ≤ abs + rel · |cpu|`. *At 1.0* is the resulting allowance for a full-white channel. *Outliers* is the fraction of channels allowed to exceed that: only filters with hard decisions (thresholds, comparisons, cell or glyph choices) have one, because a float16 intermediate can flip a pixel that sits right on the decision.',
    '',
    '**On what.** Two odd-sized images (random noise with transparent and HDR pixels; concentric rings with fading contrast), both quantised to float16 first so CPU and GPU read the same input, at the default parameters and at the extremes of every parameter (every option, an asymmetric kernel, a non-linear LUT). See `packages/filters/src/parity.browser.test.ts`. Chains add up their filters\' tolerances.',
    '',
    'For scale: one 8-bit step of sRGB output is about 0.0003 in linear light near black and 0.009 near white.',
    '',
  ];
  for (const [category, title] of CATEGORIES) {
    const group = filters.filter((f) => f.category === category);
    if (group.length === 0) continue;
    out.push(`## ${title} (${group.length})`, '', '| Filter | Kind | abs | rel | At 1.0 | Outliers |', '|---|---|---|---|---|---|');
    for (const f of group) {
      const { abs, rel, outliers = 0 } = f.tolerance as { abs: number; rel: number; outliers?: number };
      out.push(`| ${cell(f.label)} (\`${f.id}\`) | ${f.kind} | ${short(abs)} | ${short(rel)} | ${short(abs + rel)} | ${outliers ? `${short(outliers * 100)}%` : 0} |`);
    }
    out.push('');
  }
  const looser = filters.filter((f) => f.hardwareTolerance);
  if (looser.length > 0) {
    out.push(
      '## On real GPUs',
      '',
      'CI runs on a software GPU (SwiftShader), and the tolerances above are calibrated on it. Real GPUs round float16 and evaluate `pow`, `exp` and division differently, and filters that iterate or amplify (diffusion, divisions, exponents) or decide on a threshold show it: these filters declare a looser tolerance, used by the parity tests only when the adapter is not a software one. Measured with `pnpm report:parity` on one machine (NVIDIA RTX 40, Chrome, 30 Oct 2026) plus a margin; other GPUs may differ, and a report from yours is welcome.',
      '',
      '| Filter | abs | rel | Outliers |',
      '|---|---|---|---|',
    );
    for (const f of looser) {
      const { abs, rel, outliers = 0 } = f.hardwareTolerance as { abs: number; rel: number; outliers?: number };
      out.push(`| ${cell(f.label)} (\`${f.id}\`) | ${short(abs)} | ${short(rel)} | ${outliers ? `${short(outliers * 100)}%` : 0} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
