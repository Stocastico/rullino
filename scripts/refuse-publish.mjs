// `prepublishOnly` of every package: publishing from the package directory would ship the `src/*.ts`
// exports (the dist exports only exist in the tarball `pnpm pack` makes). Publishing a tarball does not
// run this hook, so the release workflow (pack, then `npm publish <tarball>`) passes.
console.error(
  'Do not publish from the package directory: `exports` would point at src/*.ts.\n' +
    'Releases go through .github/workflows/release.yml (tag vX.Y.Z), which publishes the packed tarballs.',
);
process.exit(1);
