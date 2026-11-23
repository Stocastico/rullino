import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** Every file under `dir`, relative, with forward slashes. */
const filesOf = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesOf(path) : [path];
  });

/**
 * Writes dist/sw.js from sw.template.js once the build is done: the list of every built file (a page
 * as its directory URL, `look-folder/`, as it is linked and served) and a version from their contents,
 * so a new build replaces the old cache.
 */
function offline(): Plugin {
  let outDir = '';
  return {
    name: 'rullino-tools-offline',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const all = filesOf(outDir).filter((f) => !f.endsWith(`${sep}sw.js`)).sort();
      const hash = createHash('sha256');
      for (const f of all) hash.update(relative(outDir, f)).update(readFileSync(f));
      const urls = all.map((f) => relative(outDir, f).split(sep).join('/')).map((f) => (f === 'index.html' ? './' : f.endsWith('/index.html') ? f.slice(0, -'index.html'.length) : f));
      const template = readFileSync(fileURLToPath(new URL('./sw.template.js', import.meta.url)), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__FILES__', JSON.stringify(urls, null, 2)));
    },
  };
}

// One page per tool, served at …/rullino/tools/ next to the playground; relative base so it works
// under any sub-path. The band workers of @rullino/web are ES modules.
export default defineConfig({
  base: './',
  plugins: [offline()],
  optimizeDeps: { exclude: ['@rullino/web'] },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'web-export': fileURLToPath(new URL('./web-export/index.html', import.meta.url)),
        'look-folder': fileURLToPath(new URL('./look-folder/index.html', import.meta.url)),
        'lut-maker': fileURLToPath(new URL('./lut-maker/index.html', import.meta.url)),
        compare: fileURLToPath(new URL('./compare/index.html', import.meta.url)),
      },
    },
  },
});
