/**
 * Behavioural tests for `initThemeMode` (Issue #374).
 *
 * `initThemeMode` wires the theme toggle button(s) to the document: it resolves
 * the toggle ids, gates persistence on localStorage availability, applies the
 * saved mode on init, refreshes each button's glyph / title / aria-label, cycles
 * the theme on click, and keeps Auto mode in sync with OS `prefers-color-scheme`
 * changes. Its pure helpers are covered by `theme_test.ts`; this file covers the
 * stateful DOM wiring that was previously only exercised incidentally by the
 * `docs/app.js` smoke test (which tolerates runtime errors).
 *
 * The tests stub the browser globals `initThemeMode` touches (`document`,
 * `window.matchMedia`, `localStorage`) with a real deno-dom document plus small
 * controllable mocks, then assert on observable DOM/state — never on which
 * private helper ran (Issue #312).
 */

import { DOMParser } from "@b-fuze/deno-dom";
import type { HTMLDocument } from "@b-fuze/deno-dom";
import { assert, assertEquals } from "./test_helpers.ts";
import {
  initThemeMode,
  themeModeGlyph,
  themeModeLabel,
} from "../docs/shared/theme.js";

// Theme colours mirrored from docs/shared/theme.js so assertions read clearly.
const COLOUR_LIGHT = "#f5f7fb";
const COLOUR_DARK = "#0a0e1a";

/** In-memory localStorage stand-in (persists within a single test). */
class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/** localStorage stand-in that throws on every access (private mode). */
class ThrowingStorage {
  getItem(_key: string): string | null {
    throw new Error("storage blocked (private mode)");
  }
  setItem(_key: string, _value: string): void {
    throw new Error("storage blocked (private mode)");
  }
  removeItem(_key: string): void {
    throw new Error("storage blocked (private mode)");
  }
}

/** Minimal controllable MediaQueryList mock so tests can fire OS theme changes. */
class FakeMediaQueryList {
  matches: boolean;
  private listeners: Array<() => void> = [];
  constructor(matches: boolean) {
    this.matches = matches;
  }
  addEventListener(_type: string, cb: () => void): void {
    this.listeners.push(cb);
  }
  removeEventListener(_type: string, cb: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }
  /** Update the system preference and notify subscribers. */
  emitChange(matches: boolean): void {
    this.matches = matches;
    for (const cb of this.listeners) cb();
  }
}

interface TestEnv {
  doc: HTMLDocument;
  mql: FakeMediaQueryList;
  restore: () => void;
}

/**
 * Install a fresh DOM + globals for a single test and return a teardown.
 *
 * @param buttonsHtml markup for the toggle button(s) placed in <body>
 * @param storage     localStorage stand-in
 * @param systemDark  whether the OS prefers a dark colour scheme
 */
function setupEnv(
  buttonsHtml: string,
  storage: MemoryStorage | ThrowingStorage,
  systemDark = false,
): TestEnv {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head>` +
      `<meta name="theme-color" content="#000000">` +
      `</head><body>${buttonsHtml}</body></html>`,
    "text/html",
  );
  if (!doc) throw new Error("Failed to build test document");

  const mql = new FakeMediaQueryList(systemDark);

  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const savedWindow = g.window;
  const savedDocument = g.document;
  // Deno exposes `localStorage` via a getter/setter that ignores plain
  // assignment, so swap it through its property descriptor and restore later.
  const savedLsDesc = Object.getOwnPropertyDescriptor(g, "localStorage");

  g.document = doc;
  g.window = {
    matchMedia: (_q: string) => mql,
  };
  Object.defineProperty(g, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });

  const restore = () => {
    if (savedWindow === undefined) delete g.window;
    else g.window = savedWindow;
    if (savedDocument === undefined) delete g.document;
    else g.document = savedDocument;
    if (savedLsDesc) Object.defineProperty(g, "localStorage", savedLsDesc);
    else delete g.localStorage;
  };

  return { doc, mql, restore };
}

/** Read the first theme-color meta's content. */
function metaColour(doc: HTMLDocument): string | null {
  return doc.querySelector('meta[name="theme-color"]')?.getAttribute(
    "content",
  ) ??
    null;
}

// ── init applies saved mode and labels the button ───────────────────────────

Deno.test("initThemeMode applies the saved mode and labels the button", () => {
  const storage = new MemoryStorage();
  storage.setItem("themeMode", "dark");
  const env = setupEnv(`<button id="themeToggle"></button>`, storage);
  try {
    initThemeMode();
    const btn = env.doc.getElementById("themeToggle")!;
    // Glyph, title and aria-label all reflect the resolved (saved) mode.
    assertEquals(btn.textContent, themeModeGlyph("dark"));
    const expectedTitle = `Theme: ${themeModeLabel("dark")} (tap to cycle)`;
    // `.title` is set as a property by initThemeMode (the observable value).
    assertEquals((btn as unknown as { title: string }).title, expectedTitle);
    assertEquals(btn.getAttribute("aria-label"), expectedTitle);
    // Saved dark mode is applied to the document root and theme-color meta.
    assertEquals(env.doc.documentElement!.getAttribute("data-theme"), "dark");
    assertEquals(metaColour(env.doc), COLOUR_DARK);
  } finally {
    env.restore();
  }
});

// ── click cycles the theme ──────────────────────────────────────────────────

Deno.test("initThemeMode cycles the theme on click and updates the button", () => {
  const storage = new MemoryStorage(); // empty → starts in auto
  const env = setupEnv(`<button id="themeToggle"></button>`, storage, false);
  try {
    initThemeMode();
    const btn = env.doc.getElementById("themeToggle")!;
    // Starts in auto.
    assertEquals(btn.textContent, themeModeGlyph("auto"));

    // auto → light.
    btn.dispatchEvent(new Event("click"));
    assertEquals(btn.textContent, themeModeGlyph("light"));
    assertEquals(env.doc.documentElement!.getAttribute("data-theme"), "light");
    assertEquals(metaColour(env.doc), COLOUR_LIGHT);
    assertEquals(
      btn.getAttribute("aria-label"),
      `Theme: ${themeModeLabel("light")} (tap to cycle)`,
    );

    // light → dark.
    btn.dispatchEvent(new Event("click"));
    assertEquals(btn.textContent, themeModeGlyph("dark"));
    assertEquals(env.doc.documentElement!.getAttribute("data-theme"), "dark");
    assertEquals(metaColour(env.doc), COLOUR_DARK);

    // dark → auto (data-theme attribute removed).
    btn.dispatchEvent(new Event("click"));
    assertEquals(btn.textContent, themeModeGlyph("auto"));
    assertEquals(env.doc.documentElement!.getAttribute("data-theme"), null);

    // Cycled mode is persisted back to storage.
    assertEquals(storage.getItem("themeMode"), "auto");
  } finally {
    env.restore();
  }
});

// ── persistence gate: localStorage unavailable ──────────────────────────────

Deno.test("initThemeMode falls back to auto when localStorage is unavailable", () => {
  const env = setupEnv(
    `<button id="themeToggle"></button>`,
    new ThrowingStorage(),
    false,
  );
  try {
    // Must not throw even though every storage access throws.
    initThemeMode();
    const btn = env.doc.getElementById("themeToggle")!;
    assertEquals(btn.textContent, themeModeGlyph("auto"));
    assertEquals(
      btn.getAttribute("aria-label"),
      `Theme: ${themeModeLabel("auto")} (tap to cycle)`,
    );
    // Auto mode leaves the root unthemed (tracks the OS preference).
    assertEquals(env.doc.documentElement!.getAttribute("data-theme"), null);
  } finally {
    env.restore();
  }
});

// ── no toggle buttons present → no-op, no throw ─────────────────────────────

Deno.test("initThemeMode is a no-op when no toggle button exists", () => {
  const env = setupEnv(`<div>no toggle here</div>`, new MemoryStorage());
  try {
    // Should bail out cleanly without touching the document root.
    initThemeMode();
    assertEquals(env.doc.documentElement!.getAttribute("data-theme"), null);
  } finally {
    env.restore();
  }
});

// ── multiple toggle buttons are all wired ───────────────────────────────────

Deno.test("initThemeMode wires every configured toggle button", () => {
  const storage = new MemoryStorage();
  const env = setupEnv(
    `<button id="themeToggle"></button><button id="themeToggleAlt"></button>`,
    storage,
  );
  try {
    initThemeMode({ toggleButtonIds: ["themeToggle", "themeToggleAlt"] });
    const a = env.doc.getElementById("themeToggle")!;
    const b = env.doc.getElementById("themeToggleAlt")!;
    assertEquals(a.textContent, themeModeGlyph("auto"));
    assertEquals(b.textContent, themeModeGlyph("auto"));

    // A click on the second button cycles state and refreshes BOTH buttons.
    b.dispatchEvent(new Event("click"));
    assertEquals(a.textContent, themeModeGlyph("light"));
    assertEquals(b.textContent, themeModeGlyph("light"));
  } finally {
    env.restore();
  }
});

// ── Auto mode tracks OS prefers-color-scheme changes ────────────────────────

Deno.test("initThemeMode keeps Auto mode in sync with OS theme changes", () => {
  const storage = new MemoryStorage(); // empty → auto
  const env = setupEnv(`<button id="themeToggle"></button>`, storage, false);
  try {
    initThemeMode();
    // Auto + light OS → light colour.
    assertEquals(metaColour(env.doc), COLOUR_LIGHT);

    // OS flips to dark while in Auto → theme-color follows.
    env.mql.emitChange(true);
    assertEquals(metaColour(env.doc), COLOUR_DARK);
    // Auto leaves the document root unthemed regardless of OS preference.
    assertEquals(env.doc.documentElement!.getAttribute("data-theme"), null);
  } finally {
    env.restore();
  }
});

// ── OS changes are ignored once an explicit mode is chosen ──────────────────

Deno.test("initThemeMode ignores OS changes when an explicit mode is set", () => {
  const storage = new MemoryStorage();
  const env = setupEnv(`<button id="themeToggle"></button>`, storage, false);
  try {
    initThemeMode();
    const btn = env.doc.getElementById("themeToggle")!;
    // Cycle auto → light (explicit).
    btn.dispatchEvent(new Event("click"));
    assertEquals(metaColour(env.doc), COLOUR_LIGHT);

    // OS flips to dark, but explicit Light must not change.
    env.mql.emitChange(true);
    assertEquals(metaColour(env.doc), COLOUR_LIGHT);
    assert(env.doc.documentElement!.getAttribute("data-theme") === "light");
  } finally {
    env.restore();
  }
});
