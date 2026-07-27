/**
 * Folded-tail inspector panel for the Sankey view (Issue #538).
 *
 * The per-layer fold keeps the diagram readable, but it collapses the thin and
 * absent flows a viewer hunting **dead zones** is actually looking for. This
 * panel makes the fold inspectable: selecting an "other" node lists what was
 * folded into it, weakest first, with each member's share of the Score and a
 * distinct marker for members carrying no flow at all.
 *
 * The ranking and paging live in `docs/shared/sankey_flow.js` (DOM-free, unit
 * tested); everything here is DOM only. A fold can hold thousands of members
 * (2,132 on the published snapshot), so exactly one page is ever in the DOM —
 * the work per page is constant, which is what keeps a phone responsive.
 */

import {
  DEFAULT_FOLDED_TAIL_PAGE_SIZE,
  pageFoldedTail,
  rankFoldedTail,
} from "../shared/sankey_flow.js";

const VISIBLE_CLASS = "isVisible";

/** Ids the panel markup must declare, in `docs/sankey/index.html`. */
export const FOLD_PANEL_IDS = {
  panel: "foldPanel",
  title: "foldPanelTitle",
  summary: "foldPanelSummary",
  list: "foldPanelList",
  pageInfo: "foldPanelPageInfo",
  previous: "foldPanelPrev",
  next: "foldPanelNext",
  close: "foldPanelClose",
};

/**
 * Format a share of the Score for display.
 *
 * Rounds to two decimal places, but never rounds a live contribution down to
 * "0.00%" — a thin flow is not the same finding as a dead one.
 *
 * @param {number} share — fraction of the Score (0…1).
 * @returns {string}
 */
export function formatSharePercent(share) {
  const value = Number(share);
  if (!Number.isFinite(value) || value <= 0) return "0%";
  const pct = value * 100;
  if (pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

/** One-line description of what a fold holds, including its dead zones. */
export function summariseFoldedTail(ranked) {
  const total = ranked?.total ?? 0;
  const dead = ranked?.deadCount ?? 0;
  const parts = [`${total} folded member${total === 1 ? "" : "s"}`];
  parts.push(
    dead > 0
      ? `${dead} with no flow (dead)`
      : "none dead — every member still contributes",
  );
  if (ranked?.basis === "even") {
    parts.push("no impact attributed — contributions shown as an even split");
  }
  return parts.join(" · ");
}

/** Toggle a button's disabled state via the attribute, so it is inspectable. */
function setDisabled(button, disabled) {
  if (disabled) button.setAttribute("disabled", "");
  else button.removeAttribute("disabled");
}

function requireElement(doc, id) {
  const el = doc?.getElementById?.(id);
  if (!el) {
    // Fail loud (Issue #3234): a missing element means the fold is silently
    // uninspectable again, which is the very bug #538 fixes.
    throw new Error(`Fold panel element #${id} is missing.`);
  }
  return el;
}

/**
 * Wire the `#foldPanel` markup into a controller.
 *
 * @param {Document|HTMLElement} scope — document (or root) declaring the panel.
 * @param {{ pageSize?: number }} [options]
 * @returns {{
 *   open: (node: object, context?: {totalScore?: number}) => number,
 *   close: () => void,
 *   isOpen: () => boolean,
 *   showPage: (offset: number) => void,
 *   nodeId: () => string|null,
 * }}
 */
export function createFoldPanelController(scope, options = {}) {
  const doc = scope?.getElementById ? scope : scope?.ownerDocument;
  if (!doc?.getElementById) {
    throw new Error("createFoldPanelController requires a document scope.");
  }
  const pageSize = options.pageSize ?? DEFAULT_FOLDED_TAIL_PAGE_SIZE;

  const panel = requireElement(doc, FOLD_PANEL_IDS.panel);
  const title = requireElement(doc, FOLD_PANEL_IDS.title);
  const summary = requireElement(doc, FOLD_PANEL_IDS.summary);
  const list = requireElement(doc, FOLD_PANEL_IDS.list);
  const pageInfo = requireElement(doc, FOLD_PANEL_IDS.pageInfo);
  const previous = requireElement(doc, FOLD_PANEL_IDS.previous);
  const next = requireElement(doc, FOLD_PANEL_IDS.next);
  const close = requireElement(doc, FOLD_PANEL_IDS.close);

  /** @type {{ranked: object, nodeId: string}|null} */
  let current = null;

  function row(entry) {
    const li = doc.createElement("li");
    li.className = entry.isDead ? "foldRow isDead" : "foldRow";

    const label = doc.createElement("span");
    label.className = "foldRowLabel";
    label.textContent = entry.label || entry.id;
    li.appendChild(label);

    const share = doc.createElement("span");
    share.className = "foldRowShare";
    share.textContent = entry.isDead
      ? "no flow — dead"
      : `${formatSharePercent(entry.share)} of the Score`;
    li.appendChild(share);
    return li;
  }

  function showPage(offset) {
    if (!current) return;
    const page = pageFoldedTail(current.ranked, { offset, pageSize });
    // Replace, never append: one page at a time keeps the DOM small even when
    // the fold holds thousands of members.
    list.textContent = "";
    for (const entry of page.entries) list.appendChild(row(entry));

    pageInfo.textContent = page.total === 0
      ? "Nothing folded"
      : `${page.offset + 1}–${
        page.offset + page.entries.length
      } of ${page.total}`;
    setDisabled(previous, !page.hasPrevious);
    setDisabled(next, !page.hasMore);
    previous.setAttribute("data-offset", String(page.previousOffset));
    next.setAttribute("data-offset", String(page.nextOffset));
  }

  function hide() {
    current = null;
    list.textContent = "";
    panel.classList.remove(VISIBLE_CLASS);
    panel.setAttribute("aria-hidden", "true");
  }

  previous.addEventListener("click", () => {
    showPage(Number(previous.getAttribute("data-offset") ?? 0));
  });
  next.addEventListener("click", () => {
    showPage(Number(next.getAttribute("data-offset") ?? 0));
  });
  close.addEventListener("click", () => hide());

  return {
    /**
     * List what `node` folded, weakest first. Returns the member count so a
     * caller can report it; throws if `node` is not a folded node.
     */
    open(node, context = {}) {
      const ranked = rankFoldedTail(node, {
        totalScore: context.totalScore ?? 0,
      });
      current = { ranked, nodeId: node.id };
      title.textContent = node.label || "Folded members";
      summary.textContent = summariseFoldedTail(ranked);
      panel.classList.add(VISIBLE_CLASS);
      panel.setAttribute("aria-hidden", "false");
      showPage(0);
      return ranked.total;
    },
    close: hide,
    isOpen: () => panel.classList.contains(VISIBLE_CLASS),
    showPage,
    nodeId: () => current?.nodeId ?? null,
  };
}

/**
 * Open the fold list when a folded node is activated by tap, click, Enter or
 * Space — the node is already focusable, so the keyboard path matters.
 *
 * @param {Element} el — the node group.
 * @param {object} node — the Sankey node (must be a folded "other" node).
 * @param {{open: Function}} controller
 * @param {{totalScore?: number}} [context]
 */
export function attachFoldTrigger(el, node, controller, context = {}) {
  if (!el || !controller) return;
  const open = () => controller.open(node, context);
  el.addEventListener("click", open);
  el.addEventListener("keydown", (event) => {
    if (event?.key === "Enter" || event?.key === " ") {
      event.preventDefault?.();
      open();
    }
  });
}

/**
 * Close the fold list on Escape. Taps elsewhere deliberately do *not* close it:
 * the list is a reading surface, and dismissing it while scrolling a 2,132-row
 * fold would make the dead zones unreadable.
 *
 * @param {Document|Element} root
 * @param {{close: Function}} controller
 */
export function attachFoldPanelDismissers(root, controller) {
  if (!root || !controller) return;
  root.addEventListener("keydown", (event) => {
    if (event?.key === "Escape") controller.close();
  });
}
