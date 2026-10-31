// `pnpm bench:threads [--size WxH] [--threads 1,2,4] [--runs n]`: bundles the worker and
// packages/node/bench/threads-bench.ts with Vite (workspace sources, like `bench:cpu`) and runs the
// benchmark in plain Node: the CPU renderer with 1, 2, 4... worker threads on the PLAN chains.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const outDir = mkdtempSync(join(tmpdir(), 'rullino-threads-bench-'));
try {
  for (const [entry, file] of [['packages/node/src/worker.ts', 'worker.mjs'], ['packages/node/bench/threads-bench.ts', 'bench.mjs']])
    await build({
      logLevel: 'warn',
      configFile: false,
      build: { emptyOutDir: false, ssr: entry, outDir, minify: false, rollupOptions: { output: { entryFileNames: file } } },
      ssr: { noExternal: true, external: ['sharp', 'webgpu'] },
    });
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', join(outDir, 'bench.mjs'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, RULLINO_BENCH_WORKER: pathToFileURL(join(outDir, 'worker.mjs')).href },
  });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
