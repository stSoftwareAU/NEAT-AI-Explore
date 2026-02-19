## Summary

Responsive layout overhaul for the trace explorer across mobile, tablet, and
desktop breakpoints. Closes #108.

**Changes:**

- **Breakpoint system**: Defined clear breakpoints — mobile (<640px), tablet
  (640–1024px), desktop (>1024px) — replacing the previous ad-hoc 900px/520px
  splits.
- **Mobile layout** (<640px): Single-column vertical stack with sticky trace
  breadcrumb, collapsible URL input (via `<details>`), bottom tab bar for
  Details/Issues/Candidates navigation, and touch-friendly 44x44px minimum
  targets.
- **Tablet layout** (640–1024px): Collapsible slide-in synapse panel from the
  right edge with a toggle button; neuron details take full width when panel is
  hidden.
- **Desktop layout** (>1024px): Unchanged side-by-side layout.
- **Touch-friendly sizing**: All interactive elements enforce 44x44px minimum
  touch targets on touch devices (Apple HIG), with adequate spacing between
  synapse rows.
- **Header improvements**: URL input collapses into an expandable `<details>`
  section on mobile, action buttons grouped as compact toolbar.
- **New shared module**: `docs/shared/responsive.js` — single source of truth
  for breakpoint constants (`MOBILE_MAX`, `TABLET_MAX`, `MIN_TOUCH_TARGET`) and
  helper functions (`classifyBreakpoint`, `mediaQueryFor`).
- Both light and dark themes work at all breakpoints.
- Australian English used throughout.

## Evidence

### Mobile (375px — iPhone SE)

![Mobile layout](docs/evidence/responsive-mobile-375.png)

### Tablet (768px — iPad)

![Tablet layout](docs/evidence/responsive-tablet-768.png)

### Desktop (1440px)

![Desktop layout](docs/evidence/responsive-desktop-1440.png)

## Test Plan

- Added 12 new tests in `tests/responsive_test.ts` covering:
  - Breakpoint constants (`MOBILE_MAX`, `TABLET_MAX`, `MIN_TOUCH_TARGET`)
  - `classifyBreakpoint` at key viewport widths (iPhone SE, iPhone 15, iPad,
    desktop) plus edge cases (NaN, Infinity, negative)
  - `mediaQueryFor` producing correct CSS media query strings
- Added `responsive.js` to lint coverage test
- All 223 existing + new tests pass
- Quality gate (`./quality.sh`) passes cleanly
