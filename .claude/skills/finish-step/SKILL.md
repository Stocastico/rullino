---
name: finish-step
description: Checklist for closing a rullino milestone step — local verification (typecheck, coverage, e2e, bench), CLAUDE.md upkeep, branch / PR conventions, CI watching and merging. Use before pushing a step's branch or opening its PR.
---

# Finishing a step in rullino

## Verify locally (all must pass; pipe with `set -o pipefail`)
1. `pnpm typecheck`
2. `pnpm test:coverage` — unit + GPU tests with the coverage thresholds of `vitest.config.ts`. New code comes with tests; never lower a threshold to pass (raise it when coverage improves).
3. `pnpm build && pnpm test:e2e` — when the playground or the filter list changed. New smoke checks get a mutation check too (break the feature, see the check fail).
4. `pnpm bench` — after adding or changing filters; record notable timings.

## Keep CLAUDE.md current
- Layout: new modules and what they do.
- Decisions: every non-obvious choice with its reason (and reversals).
- Traps: anything that cost time, phrased as the rule that avoids it.
- Commands: new scripts.

## Branch and PR
- One branch and one PR per step, from an up-to-date `main` (`claude/<topic>`). Small commits with clear messages.
- PR body: what and why, decisions taken, what was measured (tests, coverage, bench), anything the user must do (settings, licences).
- After opening: watch CI (the required check is `test`); fix red runs at the root, never skip or weaken tests. Merge (squash) only when CI is green and no review thread is open; then remind the user which branch to delete.
