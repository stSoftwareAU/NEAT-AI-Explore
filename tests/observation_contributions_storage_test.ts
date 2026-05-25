/**
 * Tests for docs/shared/observation_contributions_storage.js (Issue #243).
 *
 * The panel-scoped top-N stepper is persisted via localStorage. The helpers
 * must:
 *   - return the default (10) when storage is empty;
 *   - parse and clamp persisted values into [1, 100];
 *   - fall back to the default when the persisted value is corrupt;
 *   - swallow storage errors (private mode, quota exceeded) so the UI keeps
 *     working when localStorage is unavailable.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  DEFAULT_TOP_N,
  MAX_TOP_N,
} from "../docs/shared/observation_contributions.js";
import {
  loadObservationTopN,
  OBSERVATION_TOP_N_KEY,
  saveObservationTopN,
} from "../docs/shared/observation_contributions_storage.js";

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

class ThrowingStorage {
  getItem(_key: string): string | null {
    throw new Error("storage blocked (private mode)");
  }
  setItem(_key: string, _value: string): void {
    throw new Error("quota exceeded");
  }
}

Deno.test("OBSERVATION_TOP_N_KEY: panel-scoped key", () => {
  assertEquals(OBSERVATION_TOP_N_KEY, "obs-contrib.topN");
});

Deno.test("loadObservationTopN: returns default when storage empty", () => {
  const storage = new MemoryStorage();
  assertEquals(loadObservationTopN(storage), DEFAULT_TOP_N);
});

Deno.test("loadObservationTopN: returns persisted value when present", () => {
  const storage = new MemoryStorage();
  storage.setItem(OBSERVATION_TOP_N_KEY, "25");
  assertEquals(loadObservationTopN(storage), 25);
});

Deno.test("loadObservationTopN: clamps oversized persisted value", () => {
  const storage = new MemoryStorage();
  storage.setItem(OBSERVATION_TOP_N_KEY, "9999");
  assertEquals(loadObservationTopN(storage), MAX_TOP_N);
});

Deno.test("loadObservationTopN: clamps undersized persisted value", () => {
  const storage = new MemoryStorage();
  storage.setItem(OBSERVATION_TOP_N_KEY, "0");
  assertEquals(loadObservationTopN(storage), 1);
});

Deno.test("loadObservationTopN: falls back to default for corrupt value", () => {
  const storage = new MemoryStorage();
  storage.setItem(OBSERVATION_TOP_N_KEY, "not-a-number");
  assertEquals(loadObservationTopN(storage), DEFAULT_TOP_N);
});

Deno.test("loadObservationTopN: returns default when getItem throws (private mode)", () => {
  const storage = new ThrowingStorage();
  assertEquals(loadObservationTopN(storage), DEFAULT_TOP_N);
});

Deno.test("loadObservationTopN: returns default when storage is null", () => {
  assertEquals(loadObservationTopN(null), DEFAULT_TOP_N);
});

Deno.test("saveObservationTopN: writes clamped value into storage", () => {
  const storage = new MemoryStorage();
  assertEquals(saveObservationTopN(15, storage), true);
  assertEquals(storage.getItem(OBSERVATION_TOP_N_KEY), "15");
});

Deno.test("saveObservationTopN: clamps before writing", () => {
  const storage = new MemoryStorage();
  saveObservationTopN(9999, storage);
  assertEquals(storage.getItem(OBSERVATION_TOP_N_KEY), String(MAX_TOP_N));
  saveObservationTopN(0, storage);
  assertEquals(storage.getItem(OBSERVATION_TOP_N_KEY), "1");
});

Deno.test("saveObservationTopN: returns false and does not throw when setItem throws", () => {
  const storage = new ThrowingStorage();
  // Must not throw even though the underlying setItem does.
  assertEquals(saveObservationTopN(10, storage), false);
});

Deno.test("saveObservationTopN: returns false when storage is null", () => {
  assertEquals(saveObservationTopN(10, null), false);
});

Deno.test("loadObservationTopN: round-trip with saveObservationTopN", () => {
  const storage = new MemoryStorage();
  saveObservationTopN(42, storage);
  assertEquals(loadObservationTopN(storage), 42);
});

Deno.test("loadObservationTopN: missing globalThis.localStorage does not throw", () => {
  // Simulate the helper being called with the default storage in a context
  // where localStorage is not present (e.g. Deno test environment).
  // The helper resolves storage internally; passing undefined exercises that
  // code path.
  const value = loadObservationTopN(undefined);
  assert(
    typeof value === "number" && value >= 1 && value <= MAX_TOP_N,
    "load returns a sensible default rather than throwing",
  );
});
