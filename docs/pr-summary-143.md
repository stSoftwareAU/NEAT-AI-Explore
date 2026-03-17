## Summary

Archive all 25 `pr-summary-*.md` files from `docs/` into `docs/archive/` to
declutter the main `docs/` folder. No references to these files exist elsewhere
in the codebase, so no links were broken. Closes #143.

## Evidence

This is a file-move-only change with no UI impact. All 25 PR summary files
(pr-summary-84 through pr-summary-130) have been relocated to `docs/archive/`.
`./quality.sh` passes with all 353 tests green.

## Test Plan

- Verified no files match `docs/pr-summary-*.md` after the move
- Verified all 25 files exist under `docs/archive/`
- Confirmed no other files reference `pr-summary-` paths
- `./quality.sh` passes cleanly (format, lint, 353 tests)
