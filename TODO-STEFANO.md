# TODO Stefano

Things only the maintainer can do before going public. Delete the file when it is empty (it is a working list, not documentation). Written 4 Nov 2026; the plan behind it is "Before going public" in [PLAN.md](./PLAN.md).

## 1. Test on real hardware (the "within the published tolerance" claim)

The tolerances are verified on software GPUs and one RTX 40 (Windows, Chrome). Needed: one run per machine below, results kept in a file named `parity-<machine>.md`, attached to a comment on a new issue "Parity on real GPUs" (Claude then decides per filter, as for the RTX).

On each machine: `git clone`, `pnpm install` (Node >= 22.12, pnpm 10), `pnpm exec playwright install chromium` if needed.

- [ ] **Mac M1** (Apple GPU), Chrome: `pnpm report:parity`; then `pnpm test:browser` and note which tests fail.
- [ ] **Mac M1**, Safari (WebGPU needs a recent macOS; Develop menu > Feature Flags if it is off): open the [playground](https://stefanomasneri.com/rullino/), load a sample, add 3 effects (a curve, a blur, a look), try Compare, Export. Note: does it say "On the GPU" or "On the CPU (reason)"? Anything black, slow, or broken?
- [ ] **Mac M1**, Firefox: same playground check.
- [ ] **Mac Intel (10 years old)**, Chrome and Safari: same playground check. It will probably be the CPU fallback or a weak GPU; the interesting thing is how slow a 12 MP export is (use a big photo) and whether it freezes the page.
- [ ] **Windows laptop**, Firefox (and Chrome if the GPU differs from the RTX): playground check; if it has an Intel or AMD GPU, `pnpm report:parity` too.
- [ ] A **phone** (iOS Safari, Android Chrome): open the playground once. Does the page work at all?
- [ ] Optional, if you have a minute: `pnpm bench:web` on the M1 (prints a URL to open in its browser) for a second set of benchmark numbers.

For each failure write down: machine, OS and browser versions, what you did, a screenshot or the share link (the playground's Share button) or the **Code** button's JSON.

## 2. GitHub settings (only you can)

- [ ] Repository description, website (`https://stefanomasneri.com/rullino/`), topics (`webgpu`, `image-processing`, `photo-editing`, `wgsl`, `typescript`, `lut`, `konva`), a social preview image (Settings > General; the playground screenshot at 1280x640 works).
- [ ] Enable **Discussions** (Settings > General > Features) for questions, so issues stay for bugs.
- [ ] Create the labels `good first issue` and `help wanted` and put them on two or three small real issues (Claude can write the issues).
- [ ] Branch protection on `main`: required check `test` (see CLAUDE.md Decisions).

## 3. npm (manual parts)

- [ ] Trusted Publisher is set per package (CHANGELOG, "Releasing" step 1). Check the 7 packages once.
- [ ] For each package on npmjs.com the page shows the **README of the published version**, so a README fix only appears after a new release. After 0.7.0 look at each package page once.
- [ ] Optional: enable 2FA "authorization and publishing" on the account and the org (npm > Organization settings), and add a second maintainer to the `@rullino` org so the packages do not depend on one account.

## 4. Release 0.7.0

- [ ] Merge the PR "Docs for integrators + fixes" (Claude opens it).
- [ ] Merge the release PR (`node scripts/set-version.mjs 0.7.0` and the CHANGELOG section; Claude prepares it when you say go).
- [ ] From your machine: `git fetch && git tag v0.7.0 origin/main && git push origin v0.7.0`, then watch the `release` workflow.
- [ ] Check on npm that all 7 packages show 0.7.0 and the READMEs render (badges, links).
- [ ] In a clean folder: `npm init -y && npm i @rullino/web` and run the getting-started snippet.

## 5. Before the launch post

- [ ] Decide **konvaFilter** (new public API in `@rullino/konva`: yes or no) and the Filerobot example.
- [ ] Open the **Filerobot issue** (custom filters in the Filters tab); the motivation is in [docs/design/filerobot.md](./docs/design/filerobot.md).
- [ ] Record a 20-30 s screen capture of the playground (split view, Compare with a step, film strip, Code button).
- [ ] Ask Claude for: `docs/benchmarks.md` (from the #77 comments), the launch post draft (Show HN, r/webdev, r/javascript), the list of 3-5 teams on Konva or Fabric to write to.
- [ ] Reply policy: issues within 48 h for the first month (PLAN, Phase 3).
