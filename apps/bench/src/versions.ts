// Versions of the libraries under test, read from their package.json files at build time
// (vite.config.ts defines __BENCH_VERSIONS__).
declare const __BENCH_VERSIONS__: Record<string, string>;
type Library = '@rullino/core' | '@rullino/web' | 'pixi.js' | 'pixi-filters' | '@silvia-odwyer/photon' | 'wasm-vips';
export const versions = __BENCH_VERSIONS__ as Record<Library, string>;
