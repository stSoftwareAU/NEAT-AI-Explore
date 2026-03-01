## Summary

Add keyboard focus styles and accessible labels across both the trace explorer
and graph explorer views to address WCAG 2.1 Level AA compliance gaps. Closes
#124.

### Changes

- **Focus visibility (WCAG SC 2.4.7)**: Added `:focus-visible` outline rules to
  both `docs/styles.css` and `docs/graph/graph.css`
- **Accessible labels**: Added `aria-label="Snapshot URL"` to `fetchUrl` inputs
  in both views; associated the "Sort by:" label with `synapseSort` via
  `for="synapseSort"`
- **Live regions**: Added `role="status"` and `aria-live="polite"` to status
  elements in both views so screen readers announce loading/error updates
- **Tab panel labelling**: Added `aria-labelledby` to all three tab panels
  pointing at their controlling tab buttons
- **Emoji icon hiding**: Added `aria-hidden="true"` to mobile tab bar emoji
  icons so only the text label is read by screen readers
- **Modal focus management (WCAG SC 2.4.3)**: Created
  `docs/shared/modal_focus.js` with `getFocusableElements`,
  `getInitialFocusTarget`, and `installFocusTrap` helpers. All three modals
  (path inspector, observations, explain) now move focus to the close button on
  open, trap Tab within the modal panel, and return focus to the trigger element
  on close
- **Service worker**: Added `modal_focus.js` to SW precache list

## Evidence

![Trace explorer with focus styles](docs/evidence/focus-visible-trace.png)
![Graph explorer with focus styles](docs/evidence/focus-visible-graph.png)

## Test Plan

- Added 11 tests in `tests/modal_focus_test.ts` covering:
  - `FOCUSABLE_SELECTOR` includes all expected interactive element selectors
  - `getFocusableElements` edge cases (null, undefined, missing
    `querySelectorAll`, mock container)
  - `getInitialFocusTarget` edge cases (null, undefined, empty container, mock
    with focusable children)
  - `installFocusTrap` returns no-op cleanup for invalid inputs
- All 353 tests pass; `quality.sh` passes cleanly
