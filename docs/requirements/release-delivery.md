---
kind: requirement
---
# Release delivery

## Intent

Make each accepted `main` revision available as an immutable Pi package that a
consumer can install and run without the Taumel build toolchain or an npm
publication.

## Requirements

- The release pipeline shall identify a source revision as `0.0.<main-commit-count>-g<12-character-source-commit-hash>`. ^release-ahw3
- The release pipeline shall use the exact Eta revision recorded by the Taumel source revision. ^release-mpf7
- When a pull request targets `main`, the release pipeline shall run the full quality gate and the isolated consumer installation test without publishing a release. ^release-1zti
- When a revision reaches `main`, the release pipeline shall run the full quality gate and the isolated consumer installation test. ^release-cge4
- If either required validation fails for a `main` revision, then the release pipeline shall create neither a release commit, a version tag, nor a GitHub Release. ^release-4579
- When all required validation succeeds for a `main` revision, the release pipeline shall create one GitHub pre-release for that source revision. ^release-bzia
- The release checkout shall contain the prebuilt TypeScript extension and OCaml JavaScript artifacts required at runtime. ^release-chbb
- When Pi installs a release checkout with production dependencies only, Taumel shall load without Nix, opam, OCaml, Eta, Bun, or TypeScript build tools. ^release-yevc
- The release checkout's package metadata and `/taumel` status shall report the release version represented by its Git tag. ^release-h2oz
- The release pipeline shall keep generated distribution artifacts outside `main` and add them in a generated commit whose parent is the released source revision. ^release-bdqc
- The GitHub pre-release shall use the immutable version tag and GitHub-generated release notes without additional release assets. ^release-k0b1
- The release pipeline shall preserve every published version tag and GitHub Release for repeatable installation and rollback. ^release-c99u
