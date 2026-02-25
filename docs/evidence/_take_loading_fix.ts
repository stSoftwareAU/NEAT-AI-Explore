import { launch } from "https://deno.land/x/astral@0.4.10/mod.ts";

const EVIDENCE_DIR =
  "/Users/nigel/auto-issue-work/NEAT-AI-Explore/docs/evidence";

const browser = await launch({ headless: true });

// Screenshot 1: Initial loading state
console.log("Navigating to app...");
const page = await browser.newPage("http://localhost:8765/");
await new Promise((r) => setTimeout(r, 2000));
console.log("Taking loading state screenshot...");
await page.screenshot({
  path: `${EVIDENCE_DIR}/loading-status-indicator.png`,
});
console.log("Saved loading-status-indicator.png");

// Screenshot 2: After snapshot loads
console.log("Waiting for snapshot to load...");
await new Promise((r) => setTimeout(r, 15000));
console.log("Taking loaded state screenshot...");
await page.screenshot({
  path: `${EVIDENCE_DIR}/loading-complete.png`,
});
console.log("Saved loading-complete.png");
await page.close();

await browser.close();
console.log("Done!");
