// Launch options for the Chromium that runs the WebGPU tests, smoke tests and benchmark.
// Playwright's bundled headless Chromium finds no GPU adapter on Windows (requestAdapter() is null),
// while the installed Google Chrome does, so on Windows the default is the `chrome` channel.
// RULLINO_BROWSER_CHANNEL overrides it on any system: `chrome`, `chromium` (new headless mode),
// `msedge`..., or `bundled` for Playwright's own build.
// `--enable-features=Vulkan` is for Linux (SwiftShader / lavapipe); elsewhere it can hide the GPU.
export function launchOptions({ vulkan = false } = {}) {
  const channel = process.env.RULLINO_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : 'bundled');
  return {
    args: ['--enable-unsafe-webgpu', ...(vulkan && process.platform === 'linux' ? ['--enable-features=Vulkan'] : [])],
    ...(channel === 'bundled' ? {} : { channel }),
  };
}
