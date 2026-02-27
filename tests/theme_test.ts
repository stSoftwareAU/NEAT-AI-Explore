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

Deno.test("themeModeGlyph returns expected symbols", () => {
  assertEquals(themeModeGlyph("auto"), "A");
  assertEquals(themeModeGlyph("light"), "☀");
  assertEquals(themeModeGlyph("dark"), "☾");
});
