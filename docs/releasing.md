# Release Guide

The package is `signal-sdk` (import `signal-sdk`, binary `signal-sdk`), TypeScript
compiled to ESM for Node 20+. Nothing has been published to npm yet. Check name
availability and the intended npm owner before publishing.

## Verify the Source

```sh
npm ci
npm run lint                       # tsc --noEmit
npm test                           # build + node:test suite
node dist/src/cli.js validate
node dist/src/cli.js demo --scenarios 48 --output outputs/release-check
node dist/src/cli.js demo --generic --output outputs/release-check-generic
node dist/examples/return-values.js
node dist/examples/paired-comparison.js
npm run docs                       # rebuild docs/index.html and docs/llms.txt from docs/pages
npm pack --dry-run                 # inspect the tarball contents
```

CI runs the same on Node 20, 22 and 24. Inspect the actual CI results before
calling a release compatible across those versions.

Install the tarball in a fresh directory and verify `import "signal-sdk"` works and
`npx signal-sdk validate` passes. Inspect package contents for accidental
credentials, outputs, caches or unrelated source; `files` in `package.json` limits
the tarball to `dist/src`, `README.md` and `LICENSE`.

Review the assumptions and validation acceptance criteria in the statistics guide
(`docs/pages/statistics.md`), particularly severity, top-cluster independence,
the Laplace-approximation difficulty model and new-book prediction. Test the
actual provider adapter and constructed distribution before using them for real
reports.

## Publication Is Separate

1. Agree on package name, ownership, version and release notes.
2. Review the build and CI results and approve official publication.
3. Publish with `npm publish --access public` from an authorised account, or set
   up npm trusted publishing for this repository. Do not commit credentials.
4. Verify installation from npm.

There is deliberately no automatic publishing workflow in this repository.
Creating or pushing the GitHub repository does not publish a package.
