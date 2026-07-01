import { launch } from "@astral/astral";

const EVIDENCE_DIR =
  "/Users/nigel/auto-issue-work/NEAT-AI-Explore/docs/evidence";

const browser = await launch();

// Screenshot 1: Initial loading state (shows "Loading…" status before JS completes)
console.log("Navigating to app (capturing initial loading state)...");
const page = await browser.newPage("http://localhost:8765/");
// Brief wait for HTML to render but before snapshot finishes loading
await new Promise((r) => setTimeout(r, 1500));
console.log("Taking loading state screenshot...");
const loadingShot = await page.screenshot({ format: "png" });
await Deno.writeFile(
  `${EVIDENCE_DIR}/loading-status-indicator.png`,
  loadingShot,
);
console.log("Saved loading-status-indicator.png");

// Screenshot 2: After snapshot loads (shows loaded state)
console.log("Waiting for snapshot to load...");
await new Promise((r) => setTimeout(r, 15000));
console.log("Taking loaded state screenshot...");
const loadedShot = await page.screenshot({ format: "png" });
await Deno.writeFile(`${EVIDENCE_DIR}/loading-complete.png`, loadedShot);
console.log("Saved loading-complete.png");
await page.close();

await browser.close();
console.log("Done!");
