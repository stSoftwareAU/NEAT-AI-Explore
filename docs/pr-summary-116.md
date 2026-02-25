## Summary

Hide the URL/Fetch/Browse controls on all viewports after a snapshot is
successfully loaded, not just on mobile. Users can press "Clear" in the trace
explorer to reveal the controls again. Closes #116.

Previously (issue #53) the controls were only hidden on mobile
(`max-width: 639px`). This change removes the media-query wrapper so the
`body.snapshotLoaded .headerUrlDetails { display: none }` rule applies at every
screen size.

## Evidence

![URL controls hidden after fetch](docs/evidence/issue-116-hidden-after-fetch.png)

After the snapshot loads the header shows only the title and status text — the
URL input, Fetch button, and Browse button are all hidden.

## Test Plan

- Existing test suite passes (223 tests, 0 failures).
- Visual verification via Playwright screenshot confirms controls are hidden on
  desktop after snapshot load.
- The "Clear" button in the trace bar removes the `snapshotLoaded` class,
  re-revealing the controls (existing behaviour unchanged).
