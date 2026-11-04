// How far this machine's GPU is from the CPU references, case by case. Not a test: it never fails on
// numbers. The parity tests (`pnpm test:browser`) are calibrated on a software GPU (SwiftShader in CI);
// run `pnpm report:parity` on real hardware to see where it differs and by how much, then decide per
// filter. Writes packages/filters/report/parity-report.json and parity-report.md. The measurement is
// in parity.ts, shared with the hardware check page (apps/hardware-check) that does it in any browser.
import { createGpuContext } from '@rullino/core';
import { afterAll, it } from 'vitest';
import { commands } from 'vitest/browser';
import { parityMarkdown, runParity } from './parity';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

it('writes the parity report', { timeout: 600_000 }, async () => {
  const result = await runParity(ctx);
  await commands.writeFile('packages/filters/report/parity-report.json', `${JSON.stringify(result, null, 1)}\n`);
  await commands.writeFile('packages/filters/report/parity-report.md', parityMarkdown(result));
});
