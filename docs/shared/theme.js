/**
 * Shared theme mode (Light/Dark/Auto) for docs pages.
 *
 * Kept dependency-free and defensive: in privacy modes, localStorage access can
 * throw, so we keep an in-memory fallback.
 *
 * Last updated: 30-Dec-2025
 */

const THEME_STORAGE_KEY = "themeMode";
const THEME_COLOUR_LIGHT = "#f5f7fb";
const THEME_COLOUR_DARK = "#0a0e1a";

// In privacy modes, localStorage can be blocked (throws on access).
let themeModeMemory = "auto";
let themeCanPersist = false;

/**
 * @param {unknown} mode
 * @returns {"auto"|"light"|"dark"}
 */
export function normaliseThemeMode(mode) {
  const m = String(mode ?? "auto");
  if (m === "auto" || m === "light" || m === "dark") return m;
  return "auto";
}

function canUseLocalStorage() {
  try {
    const k = "__neat_theme_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch (_e) {
    return false;
  }
}

function safeGetThemeMode() {
  try {
    return normaliseThemeMode(
      localStorage.getItem(THEME_STORAGE_KEY) ?? "auto",
    );
  } catch (_e) {
    return "auto";
  }
}

function getSystemTheme() {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
  } catch (_e) {
    return "light";
  }
}

function setThemeColourForMode(mode) {
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!metas?.length) return;
  const resolved = mode === "auto" ? getSystemTheme() : mode;
  const colour = resolved === "dark" ? THEME_COLOUR_DARK : THEME_COLOUR_LIGHT;
  for (const meta of metas) meta.setAttribute("content", colour);
}

/**
 * @param {"auto"|"light"|"dark"} mode
 */
function applyThemeMode(mode) {
  const m = normaliseThemeMode(mode);
  themeModeMemory = m;

  const root = document.documentElement;
  if (m === "dark" || m === "light") root.setAttribute("data-theme", m);
  else root.removeAttribute("data-theme");

  setThemeColourForMode(m);

  if (themeCanPersist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, m);
    } catch (_e) {
      themeCanPersist = false;
    }
  }
}

export function themeModeLabel(mode) {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "Auto";
}

/**
 * Emoji glyph for each theme mode. Issue #204 replaced the literal "A" auto
 * indicator with proper emojis so the single dark/light/auto toggle reads
 * visually. VS-16 (U+FE0F) is appended to monochrome code points to request
 * the emoji presentation across browsers.
 *
 * @param {unknown} mode
 * @returns {string}
 */
export function themeModeGlyph(mode) {
  if (mode === "light") return "☀️";
  if (mode === "dark") return "🌙";
  return "🌓";
}

export function cycleThemeMode(current) {
  if (current === "auto") return "light";
  if (current === "light") return "dark";
  return "auto";
}

/**
 * Initialise theme mode and wire one or more toggle buttons.
 *
 * Multiple buttons are useful when the same control needs to appear in more
 * than one place (e.g., Issue #184 moved the trace explorer's theme toggle
 * into the trace nav row for phone viewports while keeping the header one
 * for the snapshot loading screen).
 *
 * @param {{
 *   toggleButtonId?: string,
 *   toggleButtonIds?: ReadonlyArray<string>,
 * }} [opts]
 */
export function initThemeMode(opts = {}) {
  const ids = Array.isArray(opts?.toggleButtonIds)
    ? opts.toggleButtonIds.map((s) => String(s))
    : [String(opts?.toggleButtonId ?? "themeToggle")];

  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  for (const id of ids) {
    const btn = document.getElementById(id);
    if (btn) buttons.push(/** @type {HTMLButtonElement} */ (btn));
  }
  if (buttons.length === 0) return;

  themeCanPersist = canUseLocalStorage();
  const saved = themeCanPersist ? safeGetThemeMode() : "auto";
  applyThemeMode(saved);

  const updateButtons = () => {
    const glyph = themeModeGlyph(themeModeMemory);
    const title = `Theme: ${themeModeLabel(themeModeMemory)} (tap to cycle)`;
    for (const btn of buttons) {
      btn.textContent = glyph;
      btn.title = title;
      btn.setAttribute("aria-label", title);
    }
  };

  updateButtons();

  const onClick = () => {
    const next = cycleThemeMode(themeModeMemory);
    applyThemeMode(next);
    updateButtons();
  };

  for (const btn of buttons) btn.addEventListener("click", onClick);

  // Keep Auto mode in sync with OS theme changes.
  try {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    mql?.addEventListener?.("change", () => {
      if (themeModeMemory === "auto") setThemeColourForMode("auto");
    });
  } catch (_e) {
    // No-op.
  }
}
