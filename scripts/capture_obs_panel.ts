/**
 * Capture screenshot evidence for Issue #273.
 *
 * Renders the observation contributions panel and gate chip into a static
 * HTML harness so we can capture deterministic before/after PNGs without
 * depending on a snapshot that exercises every code path.
 *
 * The "before" frame shows the legacy panel output (no effectiveShare /
 * pre-gate badge / gate chip); the "after" frame shows the new gated
 * display.
 *
 * Output: docs/evidence/issue-266/{observation-panel-before, observation-panel-after, neuron-card-after}.png
 *
 * Usage (from repo root):
 *   deno run -A scripts/capture_obs_panel.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

import {
  buildObservationContributionsHtml,
} from "../docs/shared/observation_contributions.js";
import { buildGateChipHtml } from "../docs/shared/gate_chip.js";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence/issue-266`;

// Synthetic data mimicking a gated multi-input output neuron.
const GATED_ROWS = [
  {
    uuid: "input-volume",
    score: 0.42,
    effectiveShare: 0.42,
    gateMaskedFraction: 0,
  },
  {
    uuid: "input-rsi",
    score: 0.32,
    effectiveShare: 0.08,
    gateMaskedFraction: 0.75,
  },
  {
    uuid: "input-ema-fast",
    score: 0.18,
    effectiveShare: 0.18,
    gateMaskedFraction: 0,
  },
  {
    uuid: "input-spread",
    score: 0.05,
    effectiveShare: 0.02,
    gateMaskedFraction: 0.6,
  },
  {
    uuid: "input-bias",
    score: 0.03,
    effectiveShare: 0.03,
    gateMaskedFraction: 0,
  },
];

const UNGATED_ROWS = GATED_ROWS.map((r) => ({
  uuid: r.uuid,
  score: r.score,
}));

function render(rows: typeof GATED_ROWS, withGateChip: boolean): string {
  const stylesUrl = "../../styles.css";
  const panelHtml = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: 10,
    isPhone: false,
  });
  const chipHtml = withGateChip
    ? buildGateChipHtml({
      rows: rows.map((r) => ({
        gateMaskedFraction: r.gateMaskedFraction ?? 0,
      })),
      gateUrl: "#consumer-contract",
      label: "Gate",
    })
    : "";
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <title>Issue #273 evidence</title>
    <link rel="stylesheet" href="${stylesUrl}" />
    <style>
      body { background: var(--bg, #fafafa); padding: 20px; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
      .currentNeuron { max-width: 520px; padding: 16px 20px; background: var(--card-bg, #fff); border: 1px solid #e5e7eb; border-radius: 12px; }
      .currentNeuron h2 { margin: 0; font-size: 20px; }
      .panelHost { max-width: 520px; margin-top: 16px; }
    </style>
  </head>
  <body>
    <section class="currentNeuron">
      <h2 id="currentNeuronTitle">output-0 ${chipHtml}</h2>
      <div class="neuronDescription">Primary trading decision output</div>
    </section>
    <div class="panelHost">${panelHtml}</div>
  </body>
</html>`;
}

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const beforeHtml = render(UNGATED_ROWS as typeof GATED_ROWS, false);
  const afterHtml = render(GATED_ROWS, true);

  const beforePath = `${EVIDENCE_DIR}/_before.html`;
  const afterPath = `${EVIDENCE_DIR}/_after.html`;
  await Deno.writeTextFile(beforePath, beforeHtml);
  await Deno.writeTextFile(afterPath, afterHtml);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 720, height: 720 },
      colorScheme: "light",
    });
    try {
      for (
        const [path, out] of [
          [beforePath, "observation-panel-before.png"],
          [afterPath, "observation-panel-after.png"],
        ] as const
      ) {
        const page = await context.newPage();
        const url = `file://${path}`;
        console.log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(200);
        const target = `${EVIDENCE_DIR}/${out}`;
        await page.screenshot({ path: target, fullPage: true });
        console.log(`Wrote ${target}`);
        await page.close();
      }

      // Card-only screenshot of the gated version so the gate chip is visible
      // in isolation.
      const cardPage = await context.newPage();
      await cardPage.goto(`file://${afterPath}`, {
        waitUntil: "domcontentloaded",
      });
      const card = await cardPage.$(".currentNeuron");
      if (card) {
        const cardOut = `${EVIDENCE_DIR}/neuron-card-after.png`;
        await card.screenshot({ path: cardOut });
        console.log(`Wrote ${cardOut}`);
      }
      await cardPage.close();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // Clean up scratch HTML files now that the PNGs exist.
  for (const p of [beforePath, afterPath]) {
    try {
      await Deno.remove(p);
    } catch {
      // ignore
    }
  }

  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
