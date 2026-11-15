# Contributing

1. Read [CONTRIBUTING.md](https://github.com/Stocastico/rullino/blob/main/CONTRIBUTING.md) and the **Rules** and **Traps** of [CLAUDE.md](https://github.com/Stocastico/rullino/blob/main/CLAUDE.md) (short; each cost time once).
2. `pnpm install && pnpm typecheck && pnpm test:all` (GPU tests run on a software WebGPU: no GPU needed).
3. Pick a [good first issue](https://github.com/Stocastico/rullino/labels/good%20first%20issue) or a [help wanted](https://github.com/Stocastico/rullino/labels/help%20wanted) one; comment so nobody duplicates it.
4. Tests first (red, then green). For a shader, break it on purpose and check the parity test fails.
5. Bigger ideas: an RFC issue (form "RFC") or a thread in Discussions.

Ways to help without code: RAW files under CC0 for the test set ([#186](https://github.com/Stocastico/rullino/issues/186)), parity reports from your GPU and browser ([hardware check](https://stefanomasneri.com/rullino/check/)), looks and templates for the gallery (0.13).
