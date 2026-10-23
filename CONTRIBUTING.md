# Contributing to rullino

Thanks for looking. The design and roadmap are in [PLAN.md](./PLAN.md); the working rules, decisions and known traps are in [CLAUDE.md](./CLAUDE.md) — read its **Rules** and **Traps** before a first change, they are short and each one cost time once.

## Setup

```sh
pnpm install            # Node >= 22.12, pnpm 10
pnpm dev                # playground
pnpm typecheck && pnpm test:all
```

GPU tests run in headless Chromium on a software WebGPU (SwiftShader), so no GPU is needed. See `CLAUDE.md` for the full command list (`test:coverage`, `build`, `size`, `test:pack`, `test:e2e`, `test:ml`, `bench`).

## Ground rules

- **Tests first.** Write the test, see it fail, then implement. For shaders, also break the shader on purpose and check that the parity test goes red.
- **Every filter has two implementations** (a WGSL shader and a plain TypeScript CPU reference that is the specification), CPU semantics tests, and is registered in `packages/filters/src/index.ts`. The `add-filter` skill in `.claude/skills/` lists the steps in order.
- **Zero runtime dependencies** in `packages/*`. ONNX Runtime is passed in by the caller.
- **Public API changes are deliberate**: a new export goes into the package root and into its `api.test.ts`; plumbing goes into `./internal`.
- **Generated files**: `docs/filters.md` is rewritten with `npx vitest run packages/filters -u` after changing a filter's schema. Do not edit it by hand.
- **Record decisions**: a non-obvious choice gets a row in the `CLAUDE.md` Decisions table with its reason, and anything that bit you goes under Traps.
- Changing a `package.json` dependency field needs `pnpm install` and the updated `pnpm-lock.yaml` in the same commit.

## Pull requests

One topic per pull request, based on `main`, small commits. Before pushing: `pnpm typecheck && pnpm test:all`, and `pnpm build && pnpm test:e2e` when the playground or the filter list changes. CI runs the same plus size budgets, packed-package tests and the real ML models; the `test` job must be green to merge.

## Reporting bugs and ideas

Open an issue with the template. For a rendering bug, the browser, GPU and the filter chain (the playground's share link) help most. Security problems: see [SECURITY.md](./SECURITY.md), not a public issue.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](./LICENSE). Model weights and sample photos keep their own licences ([THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)).
