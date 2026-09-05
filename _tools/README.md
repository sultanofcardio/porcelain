# Tooling

Two pages are generated; everything else is hand-edited HTML.

- `features.py` is the roadmap's inventory: eight areas, four tiers, one line per feature with its stage (`done`, `v1`, `after`, `never`). Rank is importance, so the before-1.0 rows all sit above the seam; `build.py` asserts that.
- `mockkit.py` and `mocks.py` are the VS Code mock kit and the one mock per unimplemented feature, keyed by the feature's exact name. `build.py` refuses to run if a `v1` or `after` feature has no mock, or a mock has no feature.
- `changelog.py` renders `CHANGELOG.md` from `main` (Keep a Changelog, with the pre-0.7.0 bilingual entries reduced to their English halves) into the timeline. `SHOTS` maps a release entry to the screenshot shown under it. Point `CHANGELOG` at the file; it defaults to a sibling `idea-git` checkout.
- `build.py` writes `roadmap.html` and `changelog.html`. The release workflow on `main` runs it after every publish so the changelog page never needs a hand edit.
- `preview.py` renders every page with the layout into `_preview/` for a local look without Jekyll.
