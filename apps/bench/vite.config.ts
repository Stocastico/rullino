import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

// Read from node_modules directly: several exports maps have no ./package.json entry.
const versionOf = (name: string) => (JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8')) as { version: string }).version;
const libraries = ['@rullino/core', '@rullino/web', 'pixi.js', 'pixi-filters', '@silvia-odwyer/photon', 'wasm-vips'];
const versions = Object.fromEntries(libraries.map((n) => [n, versionOf(n)]));

// wasm-vips runs its threads on SharedArrayBuffer, which needs a cross-origin isolated page; it
// also enables performance.measureUserAgentSpecificMemory (WASM memory included).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

/** sizes.json: gzip bytes per adapter: its chunk, the chunks it imports (not the harness's), its workers and WASM. */
function adapterSizes(): Plugin {
  return {
    name: 'bench-adapter-sizes',
    generateBundle(_, bundle) {
      const gz = (code: string | Uint8Array) => gzipSync(code, { level: 9 }).length;
      const entry = Object.values(bundle).find((o) => o.type === 'chunk' && o.isEntry);
      const harness = new Set<string>(entry && entry.type === 'chunk' ? [entry.fileName, ...entry.imports] : []);
      const sizes: Record<string, { js: number; wasm: number }> = {};
      for (const out of Object.values(bundle)) {
        const id = out.type === 'chunk' ? /adapters\/([\w-]+)\.ts$/.exec(out.facadeModuleId ?? '')?.[1] : undefined;
        if (!id || out.type !== 'chunk') continue;
        const files = new Set<string>();
        const walk = (name: string) => {
          if (files.has(name) || harness.has(name)) return;
          files.add(name);
          const c = bundle[name];
          if (c?.type === 'chunk') {
            c.imports.forEach(walk);
            c.dynamicImports.forEach(walk);
            for (const a of c.viteMetadata?.importedAssets ?? []) files.add(a);
          }
        };
        walk(out.fileName);
        // Workers are emitted as separate files referenced by URL: count them for the adapter that spawns them.
        for (const o of Object.values(bundle)) if (/worker/i.test(o.fileName) && o.fileName.endsWith('.js') && id === 'rullino-cpu') files.add(o.fileName);
        let js = 0;
        let wasm = 0;
        for (const f of files) {
          const o = bundle[f];
          if (!o) continue;
          if (f.endsWith('.wasm')) wasm += gz(o.type === 'asset' ? (o.source as Uint8Array) : o.code);
          else if (f.endsWith('.js')) js += gz(o.type === 'chunk' ? o.code : (o.source as string));
        }
        sizes[id] = { js, wasm };
      }
      this.emitFile({ type: 'asset', fileName: 'sizes.json', source: JSON.stringify(sizes, null, 2) });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __BENCH_VERSIONS__: JSON.stringify(versions) },
  plugins: [adapterSizes()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: { target: 'esnext' },
  // Pre-bundling breaks `new URL('…', import.meta.url)` workers and WASM inside these packages.
  optimizeDeps: { exclude: ['@rullino/web', 'wasm-vips', '@silvia-odwyer/photon'] },
});
