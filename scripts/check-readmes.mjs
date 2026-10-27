// Type-checks the ```ts blocks of the root and package READMEs against the sources (each block is a
// module of its own, so it must carry its imports), so documented examples cannot rot. Other
// code fences (js, sh, text...) are not checked. Part of `pnpm typecheck`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
// Inside the repo (git-ignored node_modules) so that @webgpu/types and onnxruntime-web resolve.
const work = join(repo, 'node_modules/.cache/readme-check');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const paths = {};
for (const name of readdirSync(join(repo, 'packages'))) {
  paths[`@rullino/${name}`] = [join(repo, 'packages', name, 'src/index.ts')];
  paths[`@rullino/${name}/internal`] = [join(repo, 'packages', name, 'src/internal.ts')];
}
const base = JSON.parse(readFileSync(join(repo, 'tsconfig.base.json'), 'utf8'));
writeFileSync(join(work, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...base.compilerOptions, paths, types: ['@webgpu/types'], noUnusedLocals: false }, include: ['*.ts'] }));

let blocks = 0;
// The root README (the quick start) and every package README.
const readmes = [['root', join(repo, 'README.md')], ...readdirSync(join(repo, 'packages')).map((name) => [name, join(repo, 'packages', name, 'README.md')])];
for (const [name, path] of readmes) {
  let readme;
  try {
    readme = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  [...readme.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].forEach((m, i) => {
    writeFileSync(join(work, `${name}-${i + 1}.ts`), m[1]);
    blocks++;
  });
}
if (blocks === 0) {
  console.log('check-readmes: no ts blocks');
  process.exit(0);
}
try {
  execFileSync(join(repo, 'node_modules/.bin/tsc'), ['-p', join(work, 'tsconfig.json')], { stdio: 'inherit' });
} catch {
  console.error('check-readmes: a README example does not compile (files in node_modules/.cache/readme-check)');
  process.exit(1);
}
console.log(`check-readmes: ${blocks} ts blocks compile`);
