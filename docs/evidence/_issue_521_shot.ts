/**
 * Issue #521 evidence — observation summary tooltips.
 *
 * Loads the real Trace Explorer against the default snapshot, enters the
 * explorer on the output neuron, then renders the *actual* `title` attribute
 * of an observation row as a visible bubble (native tooltips are OS-drawn and
 * never appear in a screenshot). The bubble text is read straight off the
 * element, so what you see is exactly what a mouse-over shows.
 *
 * Usage:
 *   deno run -A jsr:@std/http/file-server docs --port 8791 &
 *   deno run -A docs/evidence/_issue_521_shot.ts
 */
import { launch } from "@astral/astral";

// The callbacks below are serialised and executed inside the browser. The DOM
// globals are declared locally rather than via `/// <reference lib="dom" />`,
// which would leak DOM types across the whole `deno check` program and break
// the deno-dom based tests.
// deno-lint-ignore no-explicit-any
type Any = any;
declare const document: {
  querySelector(selector: string): Any;
  querySelectorAll(selector: string): Any;
  getElementById(id: string): Any;
  createElement(tag: string): Any;
  body: Any;
};

const OUT = new URL("./issue-521-observation-tooltip.png", import.meta.url);
const OUT_MODAL = new URL(
  "./issue-521-observations-modal.png",
  import.meta.url,
);
const BASE = Deno.env.get("EVIDENCE_BASE_URL") ?? "http://localhost:8791";

/** Inline CSS for the bubble that renders a row's real `title` value. */
const BUBBLE_CSS = [
  "position:fixed",
  "z-index:99999",
  "max-width:520px",
  "padding:8px 12px",
  "border-radius:6px",
  "background:#1f2430",
  "color:#e6edf3",
  "border:1px solid #4b5563",
  "font:13px/1.45 system-ui, sans-serif",
  "box-shadow:0 6px 18px rgba(0,0,0,0.45)",
].join(";");

/** Build the in-browser script that renders `selector`'s title as a bubble. */
function bubbleScript(selector: string, css: string): string {
  return `
    (() => {
      const row = document.querySelector(${JSON.stringify(selector)});
      if (!row) return "(row not found)";
      row.style.outline = "2px solid #58a6ff";
      const rect = row.getBoundingClientRect();
      const bubble = document.createElement("div");
      bubble.className = "evidenceBubble";
      bubble.textContent = row.getAttribute("title") ?? "(no title attribute)";
      bubble.style.cssText = ${JSON.stringify(css)} +
        ";left:" + Math.round(rect.left) + "px" +
        ";top:" + Math.round(rect.bottom + 8) + "px";
      document.body.appendChild(bubble);
      return bubble.textContent;
    })()
  `;
}

/** Read the `title` attribute of the first `limit` matches of `selector`. */
function titlesScript(selector: string, limit: number): string {
  return `
    Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .slice(0, ${limit})
      .map((n) => n.getAttribute("title") ?? "")
  `;
}

const browser = await launch();
const page = await browser.newPage(`${BASE}/index.html`);

// Wait for the default snapshot to fetch, decompress and render.
await new Promise((r) => setTimeout(r, 12000));

await page.evaluate(`document.getElementById("overviewExploreBtn")?.click()`);
await new Promise((r) => setTimeout(r, 4000));

console.log(
  "observation row titles:",
  await page.evaluate(
    titlesScript(".observationContributionsRow .impactBreakdownOut", 5),
  ),
);

await page.evaluate(
  `document.querySelector(".observationContributionsRow")?.scrollIntoView({ block: "center" })`,
);
await new Promise((r) => setTimeout(r, 600));

await page.evaluate(
  bubbleScript(".observationContributionsRow .impactBreakdownOut", BUBBLE_CSS),
);
await new Promise((r) => setTimeout(r, 600));

await Deno.writeFile(OUT, await page.screenshot({ format: "png" }));
console.log("saved", OUT.pathname);

// Second surface: the Observations dashboard modal.
await page.evaluate(`document.getElementById("obsBtn")?.click()`);
await new Promise((r) => setTimeout(r, 2500));

console.log(
  "observations modal row titles:",
  await page.evaluate(titlesScript(".obsRow", 3)),
);

await page.evaluate(bubbleScript(".obsRow", BUBBLE_CSS));
await new Promise((r) => setTimeout(r, 500));

await Deno.writeFile(OUT_MODAL, await page.screenshot({ format: "png" }));
console.log("saved", OUT_MODAL.pathname);

await page.close();
await browser.close();
