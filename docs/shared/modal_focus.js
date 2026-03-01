/**
 * Modal focus management helpers (WCAG SC 2.4.3).
 *
 * Pure functions that compute which element to focus or return focus to,
 * plus a lightweight focus-trap installer.
 */

/** CSS selector matching all commonly focusable elements. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Return an array of focusable elements inside `container`.
 * @param {Element} container
 * @returns {Element[]}
 */
export function getFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== "function") return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

/**
 * Determine the element that should receive focus when a modal opens.
 * Prefers the close button (first button), then the first focusable element.
 * @param {Element} modalPanel - The modal panel (role="dialog") container.
 * @returns {Element|null}
 */
export function getInitialFocusTarget(modalPanel) {
  if (!modalPanel) return null;
  const focusable = getFocusableElements(modalPanel);
  return focusable.length > 0 ? focusable[0] : null;
}

/**
 * Install a keydown listener on `container` that traps Tab focus within it.
 * Returns a cleanup function to remove the listener.
 * @param {Element} container
 * @returns {() => void} cleanup function
 */
export function installFocusTrap(container) {
  if (!container) return () => {};

  function handler(e) {
    if (e.key !== "Tab") return;
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}
