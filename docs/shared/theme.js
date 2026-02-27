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

export function themeModeGlyph(mode) {
  if (mode === "light") return "☀";
  if (mode === "dark") return "☾";
  return "A";
}

export function cycleThemeMode(current) {
  if (current === "auto") return "light";
  if (current === "light") return "dark";
  return "auto";
}

/**
 * Initialise theme mode and wire a toggle button.
 *
 * @param {{
 *   toggleButtonId?: string,
 * }} [opts]
 */
export function initThemeMode(opts = {}) {
  const btnId = String(opts?.toggleButtonId ?? "themeToggle");
  /** @type {HTMLButtonElement | null} */
  const btn = document.getElementById(btnId);
  if (!btn) return;

  themeCanPersist = canUseLocalStorage();
  const saved = themeCanPersist ? safeGetThemeMode() : "auto";
  applyThemeMode(saved);

  const updateButton = () => {
    btn.textContent = themeModeGlyph(themeModeMemory);
    btn.title = `Theme: ${themeModeLabel(themeModeMemory)} (tap to cycle)`;
    btn.setAttribute("aria-label", btn.title);
  };

  updateButton();

  btn.addEventListener("click", () => {
    const next = cycleThemeMode(themeModeMemory);
    applyThemeMode(next);
    updateButton();
  });

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
