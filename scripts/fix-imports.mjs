// Makes the emitted ESM loadable by Node and strict TypeScript resolvers: tsc leaves relative
// specifiers as written in the sources ('./color', './gpu'), so this rewrites them to the files they
// resolve to ('./color.js', './gpu/index.js') in every .js and .d.ts under the given directory.
// Usage: node scripts/fix-imports.mjs <dist-dir>
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
if (!existsSync(root)) throw new Error(`${root} does not exist: build first`);

const files = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

// from '…', import '…', import('…'), export … from '…' with a relative specifier.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*|\.{1,2})\2/g;

// new URL('./worker.ts', import.meta.url): a module worker's source file, named as Vite and the
// sources need it; the emitted file is .js.
const ASSET_URL = /(\bnew\s+URL\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\.ts\2(\s*,\s*import\.meta\.url)/g;

let rewritten = 0;
for (const file of files(root)) {
  const ext = file.endsWith('.d.ts') ? '.d.ts' : file.endsWith('.js') ? '.js' : undefined;
  if (!ext) continue;
  const out = readFileSync(file, 'utf8').replace(SPECIFIER, (match, head, quote, spec) => {
    if (/\.(js|json|mjs)$/.test(spec)) return match;
    const target = resolve(dirname(file), spec);
    const resolved = existsSync(target + ext) ? `${spec}.js` : existsSync(join(target, `index${ext}`)) ? `${spec.replace(/\/$/, '')}/index.js` : undefined;
    if (!resolved) throw new Error(`${file}: cannot resolve "${spec}"`);
    rewritten++;
    return `${head}${quote}${resolved}${quote}`;
  }).replace(ASSET_URL, (match, head, quote, spec, tail) => {
    if (!existsSync(resolve(dirname(file), `${spec}.js`))) throw new Error(`${file}: cannot resolve "${spec}.ts"`);
    rewritten++;
    return `${head}${quote}${spec}.js${quote}${tail}`;
  });
  writeFileSync(file, out);
}
console.log(`fix-imports: ${rewritten} specifiers rewritten under ${root}`);
