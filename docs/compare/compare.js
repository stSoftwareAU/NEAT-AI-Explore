/**
 * Candidate comparison page (Issue #528).
 *
 * The shared entry point for the three candidate replacement views (layered
 * DAG, Sankey contribution flow, top-impact subgraph). It loads no snapshot
 * itself: it takes one snapshot URL and wires every candidate to it — as a
 * launcher card and as a side-by-side <iframe> — so the three are evaluated on
 * identical data (parent #522).
 *
 * The candidate list and link-building live in the DOM-free
 * `docs/shared/candidate_views.js`, unit-tested by
 * `tests/candidate_comparison_test.ts`.
 */

import {
  buildCandidateHref,
  CANDIDATE_VIEWS,
} from "../shared/candidate_views.js";
import { DEFAULT_SNAPSHOT_URL } from "../shared/config.js";
import { isDangerousUrlScheme } from "../shared/snapshot_loader.js";
import { resolveSnapshotUrlFromParams } from "../shared/snapshot_loader.js";

function setStatus(text, isBad = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.className = isBad ? "status bad" : "status";
}

/** The snapshot URL shared across the candidate links (empty → view default). */
function currentSnapshotUrl() {
  const input = document.getElementById("snapshotUrl");
  return String(input?.value ?? "").trim();
}

/** Refuse dangerous URL schemes before they reach an iframe src or link. */
function validSnapshotUrl(url) {
  if (!url) return true; // empty is fine — each view uses its own default
  if (isDangerousUrlScheme(url)) {
    setStatus(
      "Refusing a dangerous URL scheme. Use http(s) or leave blank.",
      true,
    );
    return false;
  }
  return true;
}

/** Render the launcher cards, one per candidate view. */
function renderCards() {
  const list = document.getElementById("cards");
  if (!list) return;
  const url = currentSnapshotUrl();
  list.textContent = "";

  for (const view of CANDIDATE_VIEWS) {
    const li = document.createElement("li");
    li.className = "card";

    const title = document.createElement("h2");
    title.className = "cardTitle";
    title.textContent = view.label;

    const tagline = document.createElement("p");
    tagline.className = "cardTagline";
    tagline.textContent = view.tagline;

    const bestFor = document.createElement("p");
    bestFor.className = "cardBestFor";
    bestFor.textContent = `Best for: ${view.bestFor}`;

    const actions = document.createElement("div");
    actions.className = "cardActions";
    const open = document.createElement("a");
    open.className = "button";
    open.href = buildCandidateHref(view, url);
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Open view";
    open.setAttribute("aria-label", `Open the ${view.label} view`);
    actions.appendChild(open);

    li.append(title, tagline, bestFor, actions);
    list.appendChild(li);
  }
}

/** Build (or rebuild) the side-by-side iframes for the current snapshot. */
function renderSideBySide() {
  const container = document.getElementById("sideBySide");
  if (!container || container.hidden) return;
  const url = currentSnapshotUrl();
  container.textContent = "";

  for (const view of CANDIDATE_VIEWS) {
    const card = document.createElement("div");
    card.className = "frameCard";

    const title = document.createElement("p");
    title.className = "frameTitle";
    const name = document.createElement("span");
    name.textContent = view.label;
    const link = document.createElement("a");
    link.href = buildCandidateHref(view, url);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open ↗";
    title.append(name, link);

    const frame = document.createElement("iframe");
    frame.src = buildCandidateHref(view, url);
    frame.title = `${view.label} — ${view.tagline}`;
    frame.loading = "lazy";

    card.append(title, frame);
    container.appendChild(card);
  }
}

function apply() {
  const url = currentSnapshotUrl();
  if (!validSnapshotUrl(url)) return;
  renderCards();
  renderSideBySide();
  setStatus(
    url
      ? `All three views set to: ${url}`
      : "All three views set to their default snapshot.",
  );
}

function toggleSideBySide() {
  const container = document.getElementById("sideBySide");
  const btn = document.getElementById("sideBySideBtn");
  if (!container) return;
  const show = container.hidden;
  container.hidden = !show;
  if (btn) {
    btn.textContent = show ? "Hide side-by-side" : "Compare side by side";
  }
  if (show) renderSideBySide();
  else container.textContent = "";
}

function wireControls() {
  document.getElementById("applyBtn")?.addEventListener("click", apply);
  document.getElementById("snapshotUrl")?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") apply();
    },
  );
  document.getElementById("sideBySideBtn")?.addEventListener(
    "click",
    toggleSideBySide,
  );
}

function main() {
  const input = document.getElementById("snapshotUrl");
  const params = new URLSearchParams(location.search);
  let initial = DEFAULT_SNAPSHOT_URL;
  try {
    initial = resolveSnapshotUrlFromParams(params) ?? DEFAULT_SNAPSHOT_URL;
  } catch (err) {
    setStatus(err?.message ?? String(err), true);
  }
  if (input) input.value = initial;

  wireControls();
  renderCards();
}

main();
