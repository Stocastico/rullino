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
  if (params.length === 0) return `${lines.join('\n')}No parameters.\n`;
  lines.push(`| Parameter | Label | Type | Range / options | Default |${grouped ? ' Group |' : ''}`, `|---|---|---|---|---|${grouped ? '---|' : ''}`);
  for (const [key, p] of params) {
    const [type, range, def] = describe(p);
    const name = p.label ?? key;
    const label = 'unit' in p && p.unit === 'px' && !name.includes('px') ? `${name} (px)` : name;
    lines.push(`| \`${key}\` | ${cell(label)} | ${type} | ${cell(range)} | ${cell(def)} |${grouped ? ` ${p.group ?? ''} |` : ''}`);
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
