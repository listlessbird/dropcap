# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Commit: 13909c9 (`git clone --depth 1`, 2026-10-28)
- Copied with `skills/install-anti-slop/scripts/install.mjs oxlint-plugin-anti-slop`, which copies `skills/install-anti-slop/assets/anti-slop/` (the rule sources without their tests).
- Entry points: `index.ts` (generic rules) and `effect/index.ts` (Effect rules), registered in the root `vite.config.ts`.
- `@oxlint/plugins` is pinned in the workspace catalog to 1.89.0, the oxlint version Vite+ 1.4.0 bundles.

## Local deviations

- `oxlint-plugin-kd/**` turns off `no-unknown-parameters`, `no-runtime-typeof` and `require-safety-comment-for-type-assertion`. Those rules inspect raw ESTree nodes, which is the boundary these rules exist to parse.
- No rule source has been modified.

To update, follow the upstream `install-anti-slop` skill's update procedure (`references/update.md`). Do not overwrite this directory.
