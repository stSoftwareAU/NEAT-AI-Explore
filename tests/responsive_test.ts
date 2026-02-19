import { assertEquals } from "./test_helpers.ts";
import {
  classifyBreakpoint,
  mediaQueryFor,
  MIN_TOUCH_TARGET,
  MOBILE_MAX,
  TABLET_MAX,
} from "../docs/shared/responsive.js";

// ---------------------------------------------------------------------------
// Breakpoint constants
// ---------------------------------------------------------------------------

Deno.test("MOBILE_MAX is 640", () => {
  assertEquals(MOBILE_MAX, 640);
});

Deno.test("TABLET_MAX is 1024", () => {
  assertEquals(TABLET_MAX, 1024);
});

Deno.test("MIN_TOUCH_TARGET is 44 (Apple HIG)", () => {
  assertEquals(MIN_TOUCH_TARGET, 44);
});

// ---------------------------------------------------------------------------
// classifyBreakpoint
// ---------------------------------------------------------------------------

Deno.test("classifyBreakpoint returns mobile for widths below 640", () => {
  assertEquals(classifyBreakpoint(320), "mobile");
  assertEquals(classifyBreakpoint(375), "mobile"); // iPhone SE
  assertEquals(classifyBreakpoint(393), "mobile"); // iPhone 15
  assertEquals(classifyBreakpoint(639), "mobile");
});

Deno.test("classifyBreakpoint returns tablet for widths 640–1023", () => {
  assertEquals(classifyBreakpoint(640), "tablet");
  assertEquals(classifyBreakpoint(768), "tablet"); // iPad
  assertEquals(classifyBreakpoint(1023), "tablet");
});

Deno.test("classifyBreakpoint returns desktop for widths >= 1024", () => {
  assertEquals(classifyBreakpoint(1024), "desktop");
  assertEquals(classifyBreakpoint(1440), "desktop");
  assertEquals(classifyBreakpoint(2560), "desktop");
});

Deno.test("classifyBreakpoint returns desktop for edge cases", () => {
  assertEquals(classifyBreakpoint(NaN), "desktop");
  assertEquals(classifyBreakpoint(Infinity), "desktop");
  assertEquals(classifyBreakpoint(-Infinity), "desktop");
  // @ts-expect-error intentionally passing wrong type
  assertEquals(classifyBreakpoint("abc"), "desktop");
  // @ts-expect-error intentionally passing wrong type
  assertEquals(classifyBreakpoint(undefined), "desktop");
});

Deno.test("classifyBreakpoint handles zero and negative widths", () => {
  assertEquals(classifyBreakpoint(0), "mobile");
  assertEquals(classifyBreakpoint(-1), "mobile");
});

// ---------------------------------------------------------------------------
// mediaQueryFor
// ---------------------------------------------------------------------------

Deno.test("mediaQueryFor mobile produces max-width 639px", () => {
  assertEquals(mediaQueryFor("mobile"), "(max-width: 639px)");
});

Deno.test("mediaQueryFor tablet produces min/max range", () => {
  assertEquals(
    mediaQueryFor("tablet"),
    "(min-width: 640px) and (max-width: 1023px)",
  );
});

Deno.test("mediaQueryFor desktop produces min-width 1024px", () => {
  assertEquals(mediaQueryFor("desktop"), "(min-width: 1024px)");
});

Deno.test("mediaQueryFor unknown breakpoint falls back to desktop", () => {
  // @ts-expect-error intentionally passing unknown breakpoint
  assertEquals(mediaQueryFor("unknown"), "(min-width: 1024px)");
});
