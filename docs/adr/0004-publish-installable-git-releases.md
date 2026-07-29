# Publish installable Git releases

Taumel releases are immutable Pi-installable Git tags named
`v0.0.<main-commit-count>-g<12-character-source-hash>`; each tag points to an automated
commit above its source revision that adds the prebuilt JavaScript artifacts,
while `main` remains free of generated `dist/` files. Pull requests and `main`
must pass the full gate plus a production-only consumer installation test, and
release builds use the exact Eta revision recorded by Taumel. Every successful
push to `main` creates a GitHub pre-release with generated notes, and old tags
and releases remain available; history may be rewritten for exceptional repair
without version collisions because the source hash is part of the version.
