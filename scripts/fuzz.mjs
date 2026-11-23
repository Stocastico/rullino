// The property tests (`*.property.test.ts`) with many more runs than in `pnpm test`: `pnpm test:fuzz`
// (RULLINO_FUZZ_RUNS, default 20 000; a seed to replay a failure: RULLINO_FUZZ_SEED). The CI fuzz
// workflow runs it every week and by hand. New fuzz targets (the decoders of
// 0.9) are property tests too: name them `*.property.test.ts` and they run here.
import { execFileSync } from 'node:child_process';

const runs = process.env.RULLINO_FUZZ_RUNS ?? '20000';
console.log(`fuzz: property tests with ${runs} runs each${process.env.RULLINO_FUZZ_SEED ? `, seed ${process.env.RULLINO_FUZZ_SEED}` : ''}`);
execFileSync('pnpm', ['exec', 'vitest', 'run', '--project', 'unit', '--testTimeout=1800000', '.property.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, RULLINO_FUZZ_RUNS: runs },
  shell: process.platform === 'win32',
});
