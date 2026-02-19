## Summary

Add smooth animated transitions when navigating between neurons in both the
trace explorer and graph view. Closes #104.

### Trace explorer transitions

- **Cross-fade**: neuron panel content fades out (90 ms) then the new content
  fades in (180 ms) when clicking a synapse or breadcrumb.
- **Breadcrumb directional slide**: items slide in from the left when
  navigating deeper and from the right when going back.
- **Staggered synapse list**: synapse rows fade in with a per-item stagger
  delay, capped at 250 ms total so large lists stay snappy.

### Graph explorer transitions

- **Focus badge pulse**: the focus badge fades in on neuron change.
- **Smooth camera fly-to**: already existed (`travelAlongSynapse` from
  Issue #50); no changes needed.

### Performance guardrails

- Only CSS `transform` and `opacity` are animated (GPU-composited properties).
- All durations are under 300 ms.
- All animations are skipped when `prefers-reduced-motion: reduce` is active.
- Durations are configurable via CSS custom properties (`--transition-fade`,
  `--transition-breadcrumb`, `--transition-synapse-stagger`,
  `--transition-focus-pulse`).

## Evidence

This is a CSS/JS animation change. No headless browser was available in the CI
environment for automated screenshots. The transitions can be visually verified
by:

1. Opening `docs/index.html` and clicking synapse rows — observe the cross-fade
   on the neuron panel, directional breadcrumb slide, and staggered synapse
   fade-in.
2. Opening `docs/graph/index.html` and clicking neurons — observe the focus
   badge pulse and existing smooth camera fly-to.
3. Enabling `prefers-reduced-motion: reduce` in browser DevTools — all
   animations should be skipped.

## Test Plan

- Added 12 new tests in `tests/transitions_test.ts`:
  - All transition constants are under 300 ms
  - `prefersReducedMotion()` returns `false` in Deno (no `matchMedia`)
  - `synapseStaggerDelay()` returns correct values for edge cases (0 items,
    1 item, first item, small lists, large lists with budget capping)
- Added `transitions.js` to lint coverage in `tests/lint_coverage_test.ts`
- All 139 existing + new tests pass (`./quality.sh` clean)
