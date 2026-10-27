// `pnpm bench:cpu [chains|filters] [--only <id>]`: bundles packages/filters/bench/cpu-bench.ts with
// Vite (SSR build, workspace sources resolved like in the playground) and runs it in plain Node.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

const outDir = mkdtempSync(join(tmpdir(), 'rullino-bench-'));
try {
  await build({
    logLevel: 'warn',
    configFile: false,
    build: { emptyOutDir: true, ssr: 'packages/filters/bench/cpu-bench.ts', outDir, minify: false, rollupOptions: { output: { entryFileNames: 'bench.mjs' } } },
    ssr: { noExternal: true },
  });
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', join(outDir, 'bench.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
