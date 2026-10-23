# Security policy

## Supported versions

rullino is pre-1.0: only the latest published `0.x` release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting: **Security → Report a vulnerability** on the [repository](https://github.com/Stocastico/rullino/security/advisories/new). Include what you found, how to reproduce it and the affected version. You will get a first answer within a week; a fix and a coordinated disclosure follow once the problem is confirmed.

## Scope

In scope: the `@rullino/*` packages and the playground, e.g. a crafted image, `.cube` LUT, share link or serialised chain that executes code, reads data it should not, or exhausts memory in a way the documented limits do not cover; a way to make `fetchModel` accept a file other than the pinned one.

Out of scope: bugs in browsers, WebGPU drivers or ONNX Runtime themselves (report those upstream), and the content of third-party model weights.

## What the project already does

- Photos are processed in the browser and never uploaded; share links carry only the filter chain (in the URL fragment, which never reaches a server).
- Model files are fetched from pinned revisions and verified by SHA-256 and size before use.
- Releases are published from GitHub Actions with npm trusted publishing (OIDC) and provenance; there is no long-lived npm token.
