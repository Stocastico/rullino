# TODO Stefano

Things only the maintainer can do before going public. Delete the file when it is empty (it is a working list, not documentation). Written 4 Nov 2026; the plan behind it is "Before going public" in [PLAN.md](./PLAN.md).

## 0. Road to 1.0 (added 15 Nov 2026) — in this order

Claude wrote the proposal ([docs/design/road-to-1.0.md](./docs/design/road-to-1.0.md), revised the same day after a market check: the library is the headline, the web part is "rullino tools", job pages on top of it, not another editor), the umbrella issue [#165](https://github.com/Stocastico/rullino/issues/165), the epics (#166, #167, #206, #168, #170, #171, #173, and #207 for what moved after 1.0; #169 and #172 closed as deferred), the work items with RFCs (#174, #181, #196; #187 deferred), three good first issues (#201–#203), the RFC issue form and the wiki pages (`docs/wiki/`). What only you can do:

1. [x] ~~Upload the M1 reports~~ (Chrome and Safari, 15 Nov): every filter within the real-GPU tolerances, no change needed. Firefox on the M1 is still missing (section 1).
2. [x] ~~Answer the open questions~~ (15 Nov: metadata kept by default with a strip option, Cloudflare Worker yes, MIT for code + CC BY 4.0 for the spec text, the adoption gate before RAW).
   - [ ] When the short-links issue (#208) is next: a free **Cloudflare account**, a Workers KV namespace, and an API token with "Edit Cloudflare Workers" for the deploy (Claude writes the Worker and a `wrangler.toml`; the token goes in the repository's Actions secrets as `CLOUDFLARE_API_TOKEN`, never in a file). Optionally a subdomain such as `r.stefanomasneri.com`.
3. [ ] **Merge the PR #205** with the proposal (or ask for changes there).
4. [ ] **Enable Discussions** (Settings > General > Features > Discussions), with the categories *Announcements*, *Q&A*, *Ideas*, *RFCs* (open format), *Show and tell*. Then ask Claude to write the first posts (welcome + how to ask; one thread per RFC pointing at its issue). Claude cannot enable it, and the tools it has cannot post discussions until it exists.
5. [ ] **Initialise the wiki**: Wiki tab > "Create the first page" > save anything. Then from your machine: `node scripts/publish-wiki.mjs --dry-run`, then `node scripts/publish-wiki.mjs`. (Claude cannot push to `rullino.wiki.git`.)
6. [ ] **Milestones** (Issues > Milestones > New; Claude's tools cannot create them): `0.8`, `0.9`, `0.10`, `0.11`, `0.12`, `0.13`, `1.0`. Then ask Claude to put each issue in its milestone (it can set a milestone once it exists). The labels `v0.8` … `v1.0` already do the same job, so this is optional.
7. [ ] **Label colours and descriptions** (Issues > Labels): the new labels came out grey. Suggested: `roadmap-1.0` #5319e7 "Part of the road to 1.0 (#165)"; `rfc` #fbca04 "Design proposal, argued before code"; `v0.8` … `v1.0` one colour (#c5def5) "Planned for this release"; `post-1.0` #d4c5f9 "Deferred until after 1.0"; `epic` #3e4b9e. `v0.14` is no longer used: delete it.
8. [ ] **Pin** #165 (issue page > "Pin issue") so visitors see the roadmap first.
9. [ ] **A Project board** (optional; Projects > New > Roadmap layout, add the `roadmap-1.0` issues, group by label). Claude cannot create Projects.
10. [ ] **Old epics**: #66 (distribution) and #67 (launch) are on hold by your choice; close them as "not planned" with a link to #165, or leave them open. Say which and Claude does it.
11. [ ] **Release 0.8.0** (0.7.0 is out since 12 Nov): the CLI and the playground's CPU fallback are on `main` but not on npm yet. Claude prepares the version PR; you push the tag.

## 1. Test on real hardware (the "within the published tolerance" claim)

The tolerances are verified on software GPUs and one RTX 40 (Windows, Chrome). Needed: one run per machine/browser below. **Nothing to install**: open **https://stefanomasneri.com/rullino/check/** (live after the PR with the page is merged and the Pages deploy has run), press the three buttons in order (device is described on load; "Run the parity check", about a minute; "Run the speed check"), then **Copy the report** (or **Download as a file** if copying fails) and paste it as a comment on a new issue "Parity on real GPUs", with the machine's name and macOS version. Claude then decides per filter, as for the RTX.

- [x] ~~**Mac M1**: Chrome, Safari~~ (15 Nov, within the real-GPU tolerances).
- [ ] **Mac M1, Firefox** (needs a recent version for WebGPU; if the page says WebGPU is not available, that is the result: run the speed check anyway).
- [ ] **Mac Intel (10 years old)**: Safari and Chrome. It may have no WebGPU at all (old macOS / old GPU): then the page says "WebGPU: NOT AVAILABLE", and that *is* the result; still press "Run the speed check" (the CPU numbers at 12 MP matter most here) and copy the report.
- [ ] **Windows laptop**: Firefox, and Chrome if its GPU is not the RTX.
- [ ] A **phone** (iOS Safari, Android Chrome): same page; the speed check at 12 MP may be heavy, stop it if the page gets stuck and say so.
- [ ] **The playground itself** on each of the above (https://stefanomasneri.com/rullino/): load a sample, add 3 effects (a curve, a blur, a look), try Compare, Export. Is the status "On the GPU" or "On the CPU (reason)"? Anything black, slow or broken? A share link or the **Code** button's JSON goes with each problem.
- [ ] Optional, only on a machine that has Node 22 and pnpm: `pnpm report:parity` gives the same numbers as the page (the page is the easy way).

For each failure write down: machine, OS and browser versions, what you did, a screenshot.

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

- [x] The PR "Docs for integrators + fixes" and the release PR (#158, version 0.7.0 and its CHANGELOG section) are merged.
- [x] ~~Tag `v0.7.0` pushed~~ (GitHub release of 12 Nov).
- [ ] Check on npm that all 7 packages show 0.7.0 and the READMEs render (badges, links).
- [ ] In a clean folder: `npm init -y && npm i @rullino/web` and run the getting-started snippet.

- [ ] Then ask Claude for **0.8.0** (or 0.7.1): `main` already has the playground's CPU fallback in a worker (#160), the `rullino` command (#161) and `docs/benchmarks.md`, none of them on npm yet. Without it `npx rullino` does not exist for visitors.

## 5. Before the launch post

- [x] `docs/benchmarks.md` is written (from the #77 comments and `packages/web/bench/results.txt`). If you re-run `pnpm bench:web` / `pnpm bench:threads:web` on a newer release, tell Claude to update the numbers.

- [x] **konvaFilter** and the Filerobot example are done (in `main`; they reach npm with 0.7.0).
- [ ] Open the **Filerobot issue** (custom filters in the Filters tab) on https://github.com/scaleflex/filerobot-image-editor/issues, after 0.7.0 is on npm (the example needs it). Draft, to adapt in your own words:

  > **Title:** Let apps add filters to the Filters tab
  >
  > Filters are looked up by name in `Konva.Filters` (`filterStrToClass`), so an app can already register its own Konva filter and load it through `loadableDesignState: { filter: 'MyLook' }` or set it with `updateStateFnRef`. What it cannot do is show it in the Filters tab: the list is the hard-coded `AVAILABLE_FILTERS`. Would you accept a config option such as `[TOOLS.FILTERS]: { filters: [{ label, filterFn }] }` merged into that list? It is a small change, and it lets apps offer their own looks (for example LUT-based ones) next to the built-in ones. I can send a PR.
  >
  > Working example (colour looks as Konva filters, loaded by name and switched at run time): https://github.com/Stocastico/rullino/tree/main/examples/filerobot-looks

  The motivation and what was read are in [docs/design/filerobot.md](./docs/design/filerobot.md). Offer a PR only if you want to maintain it: a first contribution to someone else's repository speaks for you.
- [ ] Record a 20-30 s screen capture of the playground (split view, Compare with a step, film strip, Code button).
- [ ] Ask Claude for: the launch post draft (Show HN, r/webdev, r/javascript), the list of 3-5 teams on Konva or Fabric to write to.
- [ ] Reply policy: issues within 48 h for the first month (PLAN, Phase 3).
