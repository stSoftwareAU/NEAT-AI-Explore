/**
 * Pop-out modal controller for the network-topology diagram (Issue #241).
 *
 * Wraps the existing `modal_focus` helpers in a small DOM-driving controller
 * so the app and tests share one open/close flow. The controller is
 * deliberately thin — markup is owned by `docs/index.html`, the diagram is
 * rendered by the caller-supplied `render` callback, and focus management
 * delegates to `getInitialFocusTarget`/`installFocusTrap`.
 *
 * Behaviour matches the acceptance criteria for #241:
 *   - `open(trigger)` reveals the modal + backdrop, renders the diagram into
 *     the body, focuses the close button, traps Tab focus, and locks page
 *     scroll.
 *   - `close()` hides the modal + backdrop, removes the focus trap, returns
 *     focus to the element that opened the modal, and restores page scroll.
 *   - Close triggers: close-button click, backdrop click, Escape keydown.
 *
 * @module
 */

import {
  getInitialFocusTarget as defaultGetInitialFocusTarget,
  installFocusTrap as defaultInstallFocusTrap,
} from "./modal_focus.js";

/**
 * @typedef {Object} TopoModalOptions
 * @property {Element} modal - The dialog container (`#topoModal`).
 * @property {Element} backdrop - Full-viewport backdrop element.
 * @property {(body: Element) => void} render - Renders the diagram into the
 *   modal body. Called on every open() so the modal always reflects the
 *   latest snapshot.
 * @property {Element} [body] - Optional override for the body container; by
 *   default looked up inside the modal via `#topoModalBody`.
 * @property {Element} [closeBtn] - Optional override for the close button;
 *   by default looked up inside the modal via `.topoModalClose`.
 * @property {Document} [doc] - Document to bind the Escape listener to;
 *   defaults to `modal.ownerDocument`.
 * @property {typeof defaultGetInitialFocusTarget} [getInitialFocusTarget]
 * @property {typeof defaultInstallFocusTrap} [installFocusTrap]
 */

/**
 * @param {TopoModalOptions} opts
 * @returns {{
 *   open: (trigger?: Element|null) => void,
 *   close: () => void,
 *   isOpen: () => boolean,
 * }}
 */
export function createTopoModalController(opts) {
  const {
    modal,
    backdrop,
    render,
    body = modal.querySelector("#topoModalBody"),
    closeBtn = modal.querySelector(".topoModalClose"),
    doc = modal.ownerDocument,
    getInitialFocusTarget = defaultGetInitialFocusTarget,
    installFocusTrap = defaultInstallFocusTrap,
  } = opts;

  let trigger = null;
  let trapCleanup = null;

  function open(opener) {
    if (!modal.hidden) return;
    trigger = opener ?? (doc?.activeElement ?? null);

    if (typeof render === "function" && body) render(body);

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    if (backdrop) backdrop.hidden = false;

    // Lock page scroll while the modal owns the viewport.
    if (doc?.documentElement?.style) {
      doc.documentElement.style.overflow = "hidden";
    }

    const target = getInitialFocusTarget(modal);
    if (target && typeof target.focus === "function") target.focus();
    trapCleanup = installFocusTrap(modal);
  }

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    if (backdrop) backdrop.hidden = true;

    if (trapCleanup) {
      trapCleanup();
      trapCleanup = null;
    }
    if (doc?.documentElement?.style) {
      doc.documentElement.style.overflow = "";
    }
    if (trigger && typeof trigger.focus === "function") {
      trigger.focus();
    }
    trigger = null;
  }

  function isOpen() {
    return !modal.hidden;
  }

  // Wire close triggers. These listeners live for the lifetime of the
  // controller — they are cheap and the modal is a singleton.
  if (closeBtn) closeBtn.addEventListener("click", () => close());
  if (backdrop) backdrop.addEventListener("click", () => close());
  if (doc) {
    doc.addEventListener("keydown", (e) => {
      if (e?.key === "Escape" && !modal.hidden) close();
    });
  }

  return { open, close, isOpen };
}
