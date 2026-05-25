/**
 * Tests for docs/shared/number_format.js (#242).
 *
 * Covers the four exported helpers: formatInteger, formatDecimal,
 * formatLarge, formatSigned. Each helper must handle happy paths,
 * boundary values, and missing/non-numeric inputs by returning the
 * stable placeholder.
 */

import { assertEquals } from "./test_helpers.ts";
import {
  formatDecimal,
  formatInteger,
  formatLarge,
  formatSigned,
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

/* ── formatLarge ────────────────────────────────────────────────────────── */

Deno.test("formatLarge - values < 1000 fall through to formatInteger", () => {
  assertEquals(formatLarge(0), "0");
  assertEquals(formatLarge(7), "7");
  assertEquals(formatLarge(999), "999");
  assertEquals(formatLarge(-42), "-42");
});

Deno.test("formatLarge - thousands use 'k' suffix", () => {
  assertEquals(formatLarge(1000), "1.0k");
  assertEquals(formatLarge(1200), "1.2k");
  assertEquals(formatLarge(12345), "12.3k");
  assertEquals(formatLarge(999999), "1,000.0k");
});

Deno.test("formatLarge - millions use 'M' suffix", () => {
  assertEquals(formatLarge(1_000_000), "1.0M");
  assertEquals(formatLarge(3_400_000), "3.4M");
});

Deno.test("formatLarge - billions use 'B' suffix", () => {
  assertEquals(formatLarge(1_000_000_000), "1.0B");
});

Deno.test("formatLarge - negative values preserve sign", () => {
  assertEquals(formatLarge(-1500), "-1.5k");
});

Deno.test("formatLarge - missing or invalid input returns placeholder", () => {
  assertEquals(formatLarge(null), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatLarge(undefined), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatLarge(NaN), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatLarge(Infinity), MISSING_NUMBER_PLACEHOLDER);
});

/* ── formatSigned ───────────────────────────────────────────────────────── */

Deno.test("formatSigned - positive values include leading '+'", () => {
  assertEquals(formatSigned(3.14), "+3.14");
  assertEquals(formatSigned(0.5, 1), "+0.5");
});

Deno.test("formatSigned - negative values use minus sign", () => {
  assertEquals(formatSigned(-3.14), "-3.14");
  assertEquals(formatSigned(-0.5, 1), "-0.5");
});

Deno.test("formatSigned - zero renders without sign prefix", () => {
  assertEquals(formatSigned(0), "0.00");
  assertEquals(formatSigned(-0), "0.00");
});

Deno.test("formatSigned - large values use thousand-separators", () => {
  assertEquals(formatSigned(1234.5, 1), "+1,234.5");
  assertEquals(formatSigned(-1234.5, 1), "-1,234.5");
});

Deno.test("formatSigned - missing or invalid input returns placeholder", () => {
  assertEquals(formatSigned(null), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatSigned(undefined), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatSigned(NaN), MISSING_NUMBER_PLACEHOLDER);
  assertEquals(formatSigned(Infinity), MISSING_NUMBER_PLACEHOLDER);
});
