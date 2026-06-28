import { assertEquals } from "./test_helpers.ts";
import { MOBILE_MAX } from "../docs/shared/responsive.js";

// ---------------------------------------------------------------------------
// Breakpoint constant
// ---------------------------------------------------------------------------
// Issue #395: classifyBreakpoint, mediaQueryFor, TABLET_MAX and
// MIN_TOUCH_TARGET were removed as dead code. MOBILE_MAX remains because it is
// imported by trace_header.js and filter_layout.js.

Deno.test("MOBILE_MAX is 640", () => {
  assertEquals(MOBILE_MAX, 640);
});
