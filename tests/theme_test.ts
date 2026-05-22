import { assertEquals } from "./test_helpers.ts";
import {
  cycleThemeMode,
  normaliseThemeMode,
  themeModeGlyph,
  themeModeLabel,
} from "../docs/shared/theme.js";

// ── normaliseThemeMode ──────────────────────────────────────────────────────

Deno.test("normaliseThemeMode returns valid modes unchanged", () => {
  assertEquals(normaliseThemeMode("auto"), "auto");
  assertEquals(normaliseThemeMode("light"), "light");
  assertEquals(normaliseThemeMode("dark"), "dark");
});

Deno.test("normaliseThemeMode defaults to auto for invalid input", () => {
  assertEquals(normaliseThemeMode("invalid"), "auto");
  assertEquals(normaliseThemeMode(""), "auto");
  assertEquals(normaliseThemeMode(null), "auto");
  assertEquals(normaliseThemeMode(undefined), "auto");
  assertEquals(normaliseThemeMode(42), "auto");
});

// ── cycleThemeMode ──────────────────────────────────────────────────────────

Deno.test("cycleThemeMode cycles auto → light → dark → auto", () => {
  assertEquals(cycleThemeMode("auto"), "light");
  assertEquals(cycleThemeMode("light"), "dark");
  assertEquals(cycleThemeMode("dark"), "auto");
});

// ── themeModeLabel ──────────────────────────────────────────────────────────

Deno.test("themeModeLabel returns human-readable labels", () => {
  assertEquals(themeModeLabel("auto"), "Auto");
  assertEquals(themeModeLabel("light"), "Light");
  assertEquals(themeModeLabel("dark"), "Dark");
});

// ── themeModeGlyph ──────────────────────────────────────────────────────────

// Issue #204: the single theme toggle uses emoji glyphs so the dark/light/auto
// states read visually rather than as ambiguous letters. Variation Selector-16
// (U+FE0F) is appended to monochrome code points to request the emoji
// presentation in browsers.
Deno.test("themeModeGlyph returns emoji symbols for each mode", () => {
  assertEquals(themeModeGlyph("auto"), "🌓");
  assertEquals(themeModeGlyph("light"), "☀️");
  assertEquals(themeModeGlyph("dark"), "🌙");
});

Deno.test("themeModeGlyph falls back to auto glyph for invalid input", () => {
  // Unknown modes should not crash — they should yield the auto glyph so the
  // toggle button always renders something readable.
  assertEquals(themeModeGlyph("invalid"), "🌓");
  assertEquals(themeModeGlyph(null), "🌓");
  assertEquals(themeModeGlyph(undefined), "🌓");
});
