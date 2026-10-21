import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: ['**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/*/src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              // Headless Chromium only exposes navigator.gpu behind this flag.
              // Without a GPU (CI) it falls back to SwiftShader.
              launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
