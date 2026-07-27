/**
 * Touch/keyboard tooltip panel for the Sankey view (Issue #536).
 *
 * The SVG `<title>` children only render on desktop hover, so on a phone the
 * #521 observation summaries were unreachable. This module drives the
 * `#tooltip` panel the page already declares: it is additive — `<title>` and
 * `aria-label` stay exactly as they were.
 *
 * The panel text is always a string built elsewhere (`buildNodeTooltip` in
 * `docs/shared/sankey_flow.js`), so there is only ever one tooltip source of
 * truth. Everything here is DOM-shaped but framework-free, which keeps the
 * state transitions unit-testable (`tests/sankey_tooltip_panel_test.ts`).
 */

const VISIBLE_CLASS = "isVisible";

/** Gap kept between the panel and the viewport edge. */
export const TOOLTIP_MARGIN = 8;

/** Gap between the tap/anchor point and the panel's top-left corner. */
export const TOOLTIP_OFFSET = 12;

/** Selector for elements that own a tooltip, used to ignore taps on them. */
export const TOOLTIP_TRIGGER_SELECTOR = ".sankeyNode, .sankeyLink";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, low, high) {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * Clamp the panel's top-left corner so the whole panel stays on screen.
 *
 * On a phone-width viewport a tap near the right or bottom edge would push a
 * fixed-position panel out of view; clamping keeps it readable without moving
 * the diagram.
 *
 * @param {{
 *   x: number, y: number,
 *   panel: {width: number, height: number},
 *   viewport: {width: number, height: number},
 *   margin?: number, offset?: number,
 * }} options
 * @returns {{left: number, top: number}} clamped position in CSS pixels.
 */
export function clampTooltipPosition({
  x,
  y,
  panel,
  viewport,
  margin = TOOLTIP_MARGIN,
  offset = TOOLTIP_OFFSET,
}) {
  const maxLeft = toNumber(viewport?.width) - toNumber(panel?.width) - margin;
  const maxTop = toNumber(viewport?.height) - toNumber(panel?.height) - margin;
  return {
    left: clamp(toNumber(x) + offset, margin, maxLeft),
    top: clamp(toNumber(y) + offset, margin, maxTop),
  };
}

/**
 * Anchor point for a tooltip: the pointer position for a tap, or the element's
 * right edge for keyboard focus (where there is no pointer).
 *
 * @param {Element} el — the element that owns the tooltip.
 * @param {{clientX?: number, clientY?: number}|null} [event]
 * @returns {{x: number, y: number}}
 */
export function anchorPoint(el, event) {
  if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = el?.getBoundingClientRect?.();
  if (!rect) return { x: 0, y: 0 };
  return { x: rect.right ?? 0, y: (rect.top ?? 0) + (rect.height ?? 0) / 2 };
}

/**
 * Wrap the `#tooltip` panel element in a small show/hide controller.
 *
 * @param {Element} el — the panel element (required; missing is a page bug).
 * @param {{
 *   getViewport?: () => {width: number, height: number},
 *   measurePanel?: () => {width: number, height: number},
 * }} [options] — seams for tests; the defaults read the real viewport.
 */
export function createTooltipController(el, options = {}) {
  if (!el) {
    // Fail loud (Issue #3234): a silently absent panel is how #536 happened.
    throw new Error("Tooltip panel element is required.");
  }
  const getViewport = options.getViewport ?? (() => ({
    width: globalThis.innerWidth ?? 0,
    height: globalThis.innerHeight ?? 0,
  }));
  const measurePanel = options.measurePanel ?? (() => {
    const rect = el.getBoundingClientRect?.();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  });

  return {
    /**
     * Show `text` near `point`. Returns false (and hides) for blank text.
     * @param {string} text
     * @param {{x: number, y: number}} point
     * @returns {boolean}
     */
    show(text, point) {
      const value = String(text ?? "");
      if (value.trim() === "") {
        this.hide();
        return false;
      }
      el.textContent = value;
      el.classList.add(VISIBLE_CLASS);
      el.setAttribute("aria-hidden", "false");
      // Measure after showing — a display:none panel has no size.
      const { left, top } = clampTooltipPosition({
        x: point?.x,
        y: point?.y,
        panel: measurePanel(),
        viewport: getViewport(),
      });
      el.setAttribute("style", `left: ${left}px; top: ${top}px;`);
      return true;
    },

    hide() {
      el.classList.remove(VISIBLE_CLASS);
      el.setAttribute("aria-hidden", "true");
    },

    isVisible() {
      return el.classList.contains(VISIBLE_CLASS);
    },
  };
}

/**
 * Wire one node group or band so tapping or focusing it shows its tooltip.
 *
 * @param {Element} el — the node group or link path.
 * @param {string|(() => string)} text — the tooltip string (or a getter).
 * @param {{show: Function, hide: Function}} controller
 */
export function attachTooltipTrigger(el, text, controller) {
  if (!el || !controller) return;
  const resolve = typeof text === "function" ? text : () => text;
  el.addEventListener(
    "pointerdown",
    (event) => controller.show(resolve(), anchorPoint(el, event)),
  );
  el.addEventListener(
    "focus",
    () => controller.show(resolve(), anchorPoint(el, null)),
  );
  el.addEventListener("blur", () => controller.hide());
}

/**
 * Dismiss the panel on a tap away or on Escape.
 *
 * Trigger taps bubble to here too, so they are filtered by selector rather
 * than by stopping propagation — nothing else on the page loses the event.
 *
 * @param {Document|Element} root — usually `document`.
 * @param {{hide: Function}} controller
 * @param {{triggerSelector?: string}} [options]
 */
export function attachTooltipDismissers(root, controller, options = {}) {
  if (!root || !controller) return;
  const selector = options.triggerSelector ?? TOOLTIP_TRIGGER_SELECTOR;
  root.addEventListener("pointerdown", (event) => {
    if (event?.target?.closest?.(selector)) return;
    controller.hide();
  });
  root.addEventListener("keydown", (event) => {
    if (event?.key === "Escape") controller.hide();
  });
}
