import { assert, assertEquals } from "./test_helpers.ts";
import {
  clampPanelSize,
  clearPanelSize,
  computeDragPanelSize,
  loadPanelSize,
  PANEL_SIZE_KEYS,
  parsePanelSize,
  resolveInitialPanelSize,
  savePanelSize,
} from "../docs/shared/panel_resize.js";

// A tiny in-memory StorageLike for exercising the persistence wrappers.
function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

// A storage that throws on every access (privacy mode / quota full).
const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

// ── PANEL_SIZE_KEYS ─────────────────────────────────────────────────────────

Deno.test("PANEL_SIZE_KEYS are distinct, stable strings", () => {
  const keys = Object.values(PANEL_SIZE_KEYS);
  assertEquals(keys.length, 3);
  assertEquals(new Set(keys).size, 3);
  for (const k of keys) assert(typeof k === "string" && k.length > 0);
});

// ── parsePanelSize ──────────────────────────────────────────────────────────

Deno.test("parsePanelSize accepts positive numbers and numeric strings", () => {
  assertEquals(parsePanelSize(320), 320);
  assertEquals(parsePanelSize("320"), 320);
  assertEquals(parsePanelSize("320.5"), 320.5);
  assertEquals(parsePanelSize("  280  "), 280);
});

Deno.test("parsePanelSize rejects missing, corrupt and non-positive values", () => {
  assertEquals(parsePanelSize(null), null);
  assertEquals(parsePanelSize(undefined), null);
  assertEquals(parsePanelSize(""), null);
  assertEquals(parsePanelSize("   "), null);
  assertEquals(parsePanelSize("abc"), null);
  assertEquals(parsePanelSize("NaN"), null);
  assertEquals(parsePanelSize("Infinity"), null);
  assertEquals(parsePanelSize("-10"), null);
  assertEquals(parsePanelSize("0"), null);
  assertEquals(parsePanelSize(0), null);
  assertEquals(parsePanelSize(-5), null);
  assertEquals(parsePanelSize(Infinity), null);
  assertEquals(parsePanelSize(NaN), null);
  assertEquals(parsePanelSize({}), null);
});

// ── clampPanelSize ──────────────────────────────────────────────────────────

Deno.test("clampPanelSize keeps in-range values and clamps to bounds", () => {
  assertEquals(clampPanelSize(300, 280, 600), 300);
  assertEquals(clampPanelSize(100, 280, 600), 280);
  assertEquals(clampPanelSize(900, 280, 600), 600);
  assertEquals(clampPanelSize(280, 280, 600), 280);
  assertEquals(clampPanelSize(600, 280, 600), 600);
});

Deno.test("clampPanelSize fits the viewport when max < min", () => {
  // Viewport smaller than the minimum usable width: fitting wins.
  assertEquals(clampPanelSize(300, 280, 200), 200);
});

Deno.test("clampPanelSize returns null for non-finite inputs", () => {
  assertEquals(clampPanelSize(NaN, 280, 600), null);
  assertEquals(clampPanelSize(Infinity, 280, 600), null);
  assertEquals(clampPanelSize(300, NaN, 600), null);
  assertEquals(clampPanelSize(300, 280, Infinity), null);
});

// ── resolveInitialPanelSize ─────────────────────────────────────────────────

Deno.test("resolveInitialPanelSize restores a valid stored value", () => {
  assertEquals(
    resolveInitialPanelSize({
      stored: "420",
      fallback: 320,
      min: 280,
      max: 600,
    }),
    420,
  );
});

Deno.test("resolveInitialPanelSize clamps a stored value that no longer fits", () => {
  // Window shrank since last visit — a 900px panel is clamped to the max.
  assertEquals(
    resolveInitialPanelSize({
      stored: "900",
      fallback: 320,
      min: 280,
      max: 600,
    }),
    600,
  );
  // Corrupt-small stored value clamps up to the minimum.
  assertEquals(
    resolveInitialPanelSize({
      stored: "50",
      fallback: 320,
      min: 280,
      max: 600,
    }),
    280,
  );
});

Deno.test("resolveInitialPanelSize falls back to the clamped default", () => {
  assertEquals(
    resolveInitialPanelSize({
      stored: null,
      fallback: 320,
      min: 280,
      max: 600,
    }),
    320,
  );
  assertEquals(
    resolveInitialPanelSize({
      stored: "garbage",
      fallback: 320,
      min: 280,
      max: 600,
    }),
    320,
  );
  // Default itself is clamped to the current bounds.
  assertEquals(
    resolveInitialPanelSize({
      stored: null,
      fallback: 900,
      min: 280,
      max: 600,
    }),
    600,
  );
});

// ── computeDragPanelSize ────────────────────────────────────────────────────

Deno.test("computeDragPanelSize adds the signed delta and clamps", () => {
  assertEquals(
    computeDragPanelSize({ startSize: 320, delta: 40, min: 280, max: 600 }),
    360,
  );
  // Grow-left handles pass a negative delta to shrink.
  assertEquals(
    computeDragPanelSize({ startSize: 320, delta: -80, min: 280, max: 600 }),
    280,
  );
  // Over-drag is capped at max.
  assertEquals(
    computeDragPanelSize({ startSize: 320, delta: 500, min: 280, max: 600 }),
    600,
  );
});

Deno.test("computeDragPanelSize returns null for non-finite inputs", () => {
  assertEquals(
    computeDragPanelSize({ startSize: NaN, delta: 40, min: 280, max: 600 }),
    null,
  );
  assertEquals(
    computeDragPanelSize({ startSize: 320, delta: NaN, min: 280, max: 600 }),
    null,
  );
});

// ── loadPanelSize / savePanelSize / clearPanelSize ──────────────────────────

Deno.test("savePanelSize then loadPanelSize round-trips a value", () => {
  const storage = makeStorage();
  const key = PANEL_SIZE_KEYS.explorerNeuron;
  assertEquals(savePanelSize(key, 415, storage), true);
  assertEquals(storage.map.get(key), "415");
  assertEquals(loadPanelSize(key, storage), 415);
});

Deno.test("loadPanelSize returns null for missing or corrupt entries", () => {
  const storage = makeStorage({ [PANEL_SIZE_KEYS.graphHud]: "not-a-number" });
  assertEquals(loadPanelSize(PANEL_SIZE_KEYS.graphHud, storage), null);
  assertEquals(loadPanelSize("no.such.key", storage), null);
});

Deno.test("savePanelSize refuses non-positive/non-finite sizes", () => {
  const storage = makeStorage();
  const key = PANEL_SIZE_KEYS.graphLegend;
  assertEquals(savePanelSize(key, 0, storage), false);
  assertEquals(savePanelSize(key, -10, storage), false);
  assertEquals(savePanelSize(key, Infinity, storage), false);
  assertEquals(savePanelSize(key, NaN, storage), false);
  assertEquals(storage.map.has(key), false);
});

Deno.test("clearPanelSize removes a persisted value", () => {
  const storage = makeStorage({ [PANEL_SIZE_KEYS.graphHud]: "300" });
  assertEquals(clearPanelSize(PANEL_SIZE_KEYS.graphHud, storage), true);
  assertEquals(storage.map.has(PANEL_SIZE_KEYS.graphHud), false);
  assertEquals(loadPanelSize(PANEL_SIZE_KEYS.graphHud, storage), null);
});

Deno.test("persistence helpers stay defensive when storage throws", () => {
  const key = PANEL_SIZE_KEYS.explorerNeuron;
  assertEquals(loadPanelSize(key, throwingStorage), null);
  assertEquals(savePanelSize(key, 320, throwingStorage), false);
  assertEquals(clearPanelSize(key, throwingStorage), false);
});

Deno.test("persistence helpers no-op safely when storage is unavailable", () => {
  const key = PANEL_SIZE_KEYS.explorerNeuron;
  assertEquals(loadPanelSize(key, null), null);
  assertEquals(savePanelSize(key, 320, null), false);
  assertEquals(clearPanelSize(key, null), false);
});
