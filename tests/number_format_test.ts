/**
 * Tests for docs/shared/number_format.js (#242).
 *
 * Covers the two exported helpers: formatInteger and formatDecimal.
 * Each helper must handle happy paths, boundary values, and
 * missing/non-numeric inputs by returning the stable placeholder.
 */

import { assertEquals } from "./test_helpers.ts";
import {
  formatDecimal,
  formatInteger,
  MISSING_NUMBER_PLACEHOLDER,
} from "../docs/shared/number_format.js";

/* ── formatInteger ──────────────────────────────────────────────────────── */

Deno.test("formatInteger - small values render without separators", () => {
  assertEquals(formatInteger(0), "0");
  assertEquals(formatInteger(7), "7");
  assertEquals(formatInteger(-42), "-42");
});

Deno.test("formatInteger - thousands grouping uses en-AU comma separator", () => {
  assertEquals(formatInteger(12345), "12,345");
  assertEquals(formatInteger(1234567), "1,234,567");
});

Deno.test("formatInteger - fractional inputs are rounded", () => {
  assertEquals(formatInteger(12345.7), "12,346");
  assertEquals(formatInteger(-0.4), "-0");
});

Deno.test("formatInteger - missing or invalid input returns placeholder", () => {
  assertEquals(formatInteger(null), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatInteger(undefined), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatInteger(NaN), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(
    formatInteger("12" as unknown as number),
    MISSING_NUMBER_PLACEHOLDER,
  );
  assertEquals(formatInteger(Infinity), MISSING_NUMBER_PLACEHOLDER);
});

/* ── formatDecimal ──────────────────────────────────────────────────────── */

Deno.test("formatDecimal - default 2 decimal places", () => {
  assertEquals(formatDecimal(3.14159), "3.14");
  assertEquals(formatDecimal(0), "0.00");
  assertEquals(formatDecimal(-1.5), "-1.50");
});

Deno.test("formatDecimal - custom places", () => {
  assertEquals(formatDecimal(3.14159, 4), "3.1416");
  assertEquals(formatDecimal(0.5, 0), "1");
  assertEquals(formatDecimal(1234.5678, 1), "1,234.6");
});

Deno.test("formatDecimal - large values use thousand-separators", () => {
  assertEquals(formatDecimal(12345.678, 2), "12,345.68");
});

Deno.test("formatDecimal - missing or invalid input returns placeholder", () => {
  assertEquals(formatDecimal(null), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatDecimal(undefined), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatDecimal(NaN), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatDecimal(Infinity), MISSING_NUMBER_PLACEHOLDER);
});
