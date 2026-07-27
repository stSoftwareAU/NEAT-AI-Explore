/**
 * Keyboard navigation helpers for the starfield camera (Issue #529).
 *
 * The starfield flies on WASD/QE/arrow keys held down. Recording those presses
 * needs two guards that are easy to get wrong in an event handler:
 *
 * - Keys typed into a text field belong to the field, not the camera. Without
 *   this guard, typing a snapshot URL containing "w", "a", "s" or "d" flew the
 *   camera away from the focused neuron.
 * - A held key whose `keyup` never arrives (tab switch, window blur, browser
 *   chrome stealing focus) stays "held" forever, so the camera drifts until the
 *   user presses and releases that key again.
 *
 * Keeping the rules here — rather than inline in `docs/graph/graph.js`, which
 * needs a browser — makes them unit-testable.
 */

/**
 * Normalises a `KeyboardEvent.key` to the lower-case form used for lookups.
 *
 * @param {unknown} key - Raw `event.key` value (may be missing on synthetic events).
 * @returns {string} Lower-cased key name, or `""` when absent.
 */
export function normaliseKeyName(key) {
  return key == null ? "" : String(key).toLowerCase();
}

/** Elements whose own keystrokes must never reach the camera. */
const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);

/**
 * Reports whether a key event targeting `target` is text entry rather than
 * camera navigation.
 *
 * Buttons and links are deliberately *not* editable: pressing W while the Zoom
 * button holds focus should still fly the camera.
 *
 * @param {unknown} target - The event target (typically `event.target`).
 * @returns {boolean} True when the target consumes its own keystrokes.
 */
export function isEditableEventTarget(target) {
  if (!target || typeof target !== "object") return false;
  const el = /** @type {Element} */ (target);
  if (EDITABLE_TAGS.has(String(el.tagName ?? "").toLowerCase())) return true;

  // Walk ancestors so a keystroke inside a contenteditable host counts as text
  // entry. The nearest explicit value wins, so `contenteditable="false"` can
  // carve a non-editable island out of an editable region.
  for (let node = el; node; node = node.parentElement) {
    const value = node.getAttribute?.("contenteditable");
    if (value == null) continue;
    return String(value).toLowerCase() !== "false";
  }
  return false;
}

/**
 * Creates the set of currently-held camera keys.
 *
 * @returns {{
 *   press: (key: unknown, target: unknown) => boolean,
 *   release: (key: unknown) => void,
 *   clear: () => void,
 *   has: (key: unknown) => boolean,
 *   readonly size: number,
 * }}
 */
export function createFlyKeyState() {
  /** @type {Set<string>} */
  const held = new Set();
  return {
    /** Records a press unless it belongs to a text field. Returns true if held. */
    press(key, target) {
      const name = normaliseKeyName(key);
      if (!name || isEditableEventTarget(target)) return false;
      held.add(name);
      return true;
    },
    /** Releases a key. Never target-guarded — a keyup must always be honoured. */
    release(key) {
      held.delete(normaliseKeyName(key));
    },
    /** Releases every held key (window blur, tab hidden, focus entering a field). */
    clear() {
      held.clear();
    },
    has(key) {
      return held.has(normaliseKeyName(key));
    },
    get size() {
      return held.size;
    },
  };
}
