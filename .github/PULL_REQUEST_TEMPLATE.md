## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] Tests written first and seen failing (for shaders: the parity test goes red on a deliberately broken shader)
- [ ] `pnpm typecheck && pnpm test:all`
- [ ] `pnpm build && pnpm test:e2e` (playground or filter list changed)
- [ ] Public API change: new export in the package root and its `api.test.ts` list
- [ ] `docs/filters.md` regenerated if a filter schema changed (`npx vitest run packages/filters -u`)
- [ ] `CLAUDE.md`: a Decisions row for non-obvious choices, a Trap for anything that bit
