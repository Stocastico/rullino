// Registers the service worker that makes the tools work offline once loaded (see sw.template.js).
// The dev server has no sw.js (only the build writes it): there the registration fails with a warning.
export function registerOffline(): void {
  if (!('serviceWorker' in navigator)) return;
  // The page's chunk is in assets/: the worker is at the root of the tools.
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname }).catch((e) => console.warn('rullino tools: offline use is not available:', e));
}
