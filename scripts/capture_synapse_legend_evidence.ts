/**
 * Capture screenshot evidence of the inbound-synapses panel weight colour
 * legend (#244) — diverging red↔blue palette on a single line.
 *
 * Renders a small standalone HTML harness that pulls in the production CSS
 * and the {@link synapseWeightColourCss} mapping, then screenshots the legend
 * at desktop and narrow viewports. Avoids depending on a live snapshot.
 *
 * Usage (from repo root):
 *   ./helpers/server.sh 8092 docs &
 *   deno run -A scripts/capture_synapse_legend_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = "http://localhost:8092";

// Inline harness page served via data: URL — same CSS rules as the app.
const HARNESS_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>#244 legend evidence</title>
<link rel="stylesheet" href="${BASE_URL}/styles.css">
<style>
  body { margin: 24px; font-family: system-ui, sans-serif; background: #f5f7fb; color: #1a1d23; }
  .synapseList { max-width: 760px; border: 1px solid #d0d4dc; border-radius: 8px; background: #fff; }
  h3 { font-size: 13px; margin: 0 0 6px; color: #555; font-weight: 600; }
</style>
</head><body>
<h3>Inbound-synapses weight colour legend (#244)</h3>
<section class="synapseList">
  <div class="synapseLegend" title="Synapse weight colour scale: red for negative, blue for positive, grey near zero (signed weight).">
    <div class="legendItems" id="items"></div>
  </div>
</section>
<script type="module">
  import { synapseWeightColourCss } from "${BASE_URL}/shared/colour_maps.js";
  const max = 5;
  const items = [
    [-max, "Strong −"],
    [-max * 0.3, "Weak −"],
    [0, "≈ 0"],
    [max * 0.3, "Weak +"],
    [max, "Strong +"],
  ];
  document.getElementById("items").innerHTML = items.map(([w, l]) =>
    \`<span><span class="legendSwatch" style="background:\${synapseWeightColourCss(w, max)}"></span>\${l}</span>\`
  ).join("");
</script>
</body></html>`;

async function capture(
  browser: import("playwright").Browser,
  harnessUrl: string,
  viewport: { width: number; height: number },
  out: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport,
    colorScheme: "light",
  });
  try {
    const page = await context.newPage();
    await page.goto(harnessUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".synapseLegend .legendSwatch", {
      timeout: 10_000,
    });
    await page.waitForTimeout(200);
    const legend = await page.$(".synapseList");
    if (!legend) throw new Error(".synapseList not found");
    await legend.screenshot({ path: out });
    console.log(`Wrote ${out}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });
  // Write the harness into docs/ so module imports resolve against the same
  // origin as the live app. Removed in a finally{} below.
  const harnessPath = `${REPO_ROOT}docs/_legend_harness_244.html`;
  await Deno.writeTextFile(harnessPath, HARNESS_HTML);
  const harnessUrl = `${BASE_URL}/_legend_harness_244.html`;

  const browser = await chromium.launch({ headless: true });
  try {
    await capture(
      browser,
      harnessUrl,
      { width: 1280, height: 400 },
      `${EVIDENCE_DIR}/issue-244-legend-desktop.png`,
    );
    await capture(
      browser,
      harnessUrl,
      { width: 420, height: 400 },
      `${EVIDENCE_DIR}/issue-244-legend-mobile.png`,
    );
  } finally {
    await browser.close();
    await Deno.remove(harnessPath).catch(() => {});
  }

  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
