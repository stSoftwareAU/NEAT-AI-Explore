## Summary

Add smooth animated transitions when navigating between neurons in both the
trace explorer and graph explorer. Closes #104.

### Trace explorer transitions

- **Cross-fade**: the current neuron panel fades out/in with a subtle vertical
  slide when switching neurons (180 ms).
- **Directional breadcrumb slide**: breadcrumb items animate left (going deeper)
  or right (going back) to indicate navigation direction (200 ms).
- **Staggered synapse fade-in**: synapse rows fade in sequentially with a capped
  stagger delay so long lists don't take too long (180 ms each, 250 ms total
  cap).

### Graph explorer transitions

- **Smooth camera fly-to**: reduced from 400 ms to 250 ms (under the 300 ms
  guardrail) using the shared `CAMERA_FLY_MS` constant.
- **Focus pulse highlight**: newly focused node labels briefly pulse with a glow
  effect (280 ms).
- **Label fade**: adjacent node labels fade in/out as the neighbourhood changes
  (200 ms CSS transition on opacity).

### Performance guardrails

- Only `transform` and `opacity` are animated (GPU-composited properties).
- All individual animation durations are capped at 300 ms.
- `prefers-reduced-motion: reduce` skips all animations entirely — both CSS and
  JS-driven camera animations.
- Durations are configurable via CSS custom properties
  (`--transition-crossfade`, `--transition-breadcrumb`,
  `--transition-synapse-fade`, `--transition-focus-pulse`).

### New shared module

`docs/shared/transitions.js` — a pure, DOM-free module exporting duration
constants and helpers (`prefersReducedMotion`, `synapseStaggerDelay`). Fully
unit-tested in Deno.

## Evidence

![Trace explorer overview dashboard](docs/evidence/trace-explorer-transitions.png)

![Graph explorer with transitions](docs/evidence/graph-explorer-transitions.png)

## Test Plan

- Added `tests/transitions_test.ts` with 10 tests covering:
  - All duration constants are positive numbers
  - All per-animation durations are at most 300 ms (performance guardrail)
  - `prefersReducedMotion` returns `false` in Deno (no matchMedia)
  - `synapseStaggerDelay` edge cases (first item, single item, empty list,
    negative index)
  - Stagger delay increases with index
  - Total stagger never exceeds the cap
  - Small lists use the per-item step
- Added `transitions.js` to lint coverage regression tests
- All 137 existing + new tests pass
