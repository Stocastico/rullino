import { playwright } from '@vitest/browser-playwright';
import { renderOnDawn } from './packages/node/test/dawn-command';
import { defineConfig } from 'vitest/config';
import { launchOptions } from './scripts/browser-launch.mjs';

export default defineConfig({
  test: {
    // `pnpm test:coverage`: unit + browser projects together (v8 coverage works in Chromium too).
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/playground/src/**/*.ts'],
      // main.ts is the playground's entry wiring: the e2e smoke test (scripts/smoke.mjs) exercises it.
      // worker.ts: the scripts of the CPU workers (web, node) run in threads the coverage of the test process cannot see; the worker tests run them for real.
      exclude: ['**/*.test.ts', '**/test-utils.ts', '**/*.d.ts', 'apps/playground/src/main.ts', 'packages/*/src/worker.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Just below what is measured, per area (the whole area's total, not each file): a drop
      // fails CI, rounding noise does not. Raise them when coverage improves; never lower them to
      // make a PR pass.
      thresholds: {
        'packages/*/src/**': { lines: 99, statements: 97.5, functions: 99, branches: 94, perFile: false },
        'apps/playground/src/**': { lines: 98.5, statements: 97.5, functions: 97, branches: 86, perFile: false },
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
          exclude: ['**/*.browser.test.ts'],
        },
      },
      {
        // The ML models themselves (downloaded by scripts/fetch-models.mjs): `pnpm test:ml`.
        test: {
          name: 'ml',
          environment: 'node',
          include: ['packages/ml/test/**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'bench',
          include: ['packages/*/bench/**/*.bench.browser.ts'],
          testTimeout: 600_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: launchOptions({ vulkan: true }) }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        // How far this machine's GPU is from the CPU references, filter by filter: `pnpm report:parity`.
        test: {
          name: 'report',
          include: ['packages/*/report/**/*.report.browser.ts'],
          testTimeout: 600_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: launchOptions({ vulkan: true }) }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/*/src/**/*.browser.test.ts', 'apps/*/src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            // Runs in Node: the browser-vs-Node test renders the same documents on Dawn through it.
            commands: { renderOnDawn },
            headless: true,
            provider: playwright({
              // Headless Chromium only exposes navigator.gpu behind --enable-unsafe-webgpu.
              // Without a GPU (CI) it falls back to SwiftShader. On Windows: the installed Chrome.
              launchOptions: launchOptions({ vulkan: true }),
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
