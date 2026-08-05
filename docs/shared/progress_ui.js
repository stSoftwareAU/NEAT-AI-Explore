/**
 * Status line + progress bar controller (Issue #597).
 *
 * The Trace, DAG, Graph and Subgraph views all drive the same widget markup —
 * `#status.statusInline` plus `#progressContainer` > `#progressBar.progressBar`
 * — and each used to carry its own private copy of the
 * `setStatus` / `showProgress` / `updateProgress` / `hideProgress` quadruplet.
 * The copies diverged: two views pulsed an unknown-size load via the
 * `.indeterminate` class while the other two faked it with a static 35% bar,
 * and only three of the four null-guarded `setStatus`. This module is the
 * single source of truth for "how a view drives that widget" so a change to
 * the contract lands in one place.
 *
 * The controller is DOM-driving but framework-free: each view constructs it
 * once with its own elements. Missing elements are tolerated (a view may not
 * render a progress bar) but a nonsensical percentage throws rather than
 * silently painting `width: NaN%`.
 *
 * @module
 */

/**
 * @typedef {Object} ClassListLike
 * @property {(name: string) => void} add
 * @property {(name: string) => void} remove
 */

/**
 * @typedef {Object} ProgressUiElements
 * @property {{ textContent: string, className: string } | null} [status] —
 *   the inline status line (`#status`).
 * @property {{ style: Record<string, string> } | null} [progressContainer] —
 *   the progress-bar track (`#progressContainer`).
 * @property {{ style: Record<string, string>, classList: ClassListLike } |
 *   null} [progressBar] — the filled bar (`#progressBar`).
 */

/**
 * Build the status/progress controller for one view.
 *
 * @param {ProgressUiElements} elements
 * @returns {{
 *   setStatus: (msg: unknown, kind?: string) => void,
 *   showProgress: (indeterminate?: boolean) => void,
 *   updateProgress: (percent: number) => void,
 *   hideProgress: () => void,
 * }}
 */
export function createProgressUi(elements) {
  if (!elements || typeof elements !== "object") {
    throw new TypeError(
      "createProgressUi requires an object of widget elements",
    );
  }
  const { status, progressContainer, progressBar } = elements;

  /**
   * Write the status line.
   *
   * @param {unknown} msg — message text (nullish renders as empty).
   * @param {string} [kind] — modifier class, e.g. "good" | "warn" | "bad".
   */
  function setStatus(msg, kind = "") {
    if (!status) return;
    status.textContent = String(msg ?? "");
    status.className = kind ? `statusInline ${kind}` : "statusInline";
  }

  /**
   * Reveal the progress bar.
   *
   * @param {boolean} [indeterminate] — true when the total size is unknown;
   *   the bar pulses via the `.indeterminate` CSS animation instead of
   *   claiming a percentage it does not know.
   */
  function showProgress(indeterminate = false) {
    if (!progressContainer || !progressBar) return;
    progressContainer.style.display = "";
    progressBar.style.width = indeterminate ? "" : "0%";
    if (indeterminate) progressBar.classList.add("indeterminate");
    else progressBar.classList.remove("indeterminate");
  }

  /**
   * Paint a determinate percentage, cancelling any indeterminate pulse.
   *
   * @param {number} percent — clamped to 0–100.
   * @throws {TypeError} when `percent` is not a finite number — a caller that
   *   divides by a zero total is a bug, not a progress state to paint.
   */
  function updateProgress(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `updateProgress expects a finite percentage, got ${String(percent)}`,
      );
    }
    if (!progressBar) return;
    progressBar.classList.remove("indeterminate");
    progressBar.style.width = `${Math.min(100, Math.max(0, value))}%`;
  }

  /** Hide the progress bar. */
  function hideProgress() {
    if (!progressContainer) return;
    progressContainer.style.display = "none";
  }

  return { setStatus, showProgress, updateProgress, hideProgress };
}
