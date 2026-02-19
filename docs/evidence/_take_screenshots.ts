import { launch } from "https://deno.land/x/astral/mod.ts";

const browser = await launch();

// Screenshot 1: Trace explorer
console.log("Navigating to trace explorer...");
const tracePage = await browser.newPage("http://localhost:8765/");
// Wait for the snapshot to load - give it time to fetch and render
await new Promise((r) => setTimeout(r, 5000));
console.log("Taking trace explorer screenshot...");
await tracePage.screenshot({
  path:
    "/Users/nigel/auto-issue-work/NEAT-AI-Explore/docs/evidence/trace-synapse-colours.png",
});
console.log("Saved trace-synapse-colours.png");
await tracePage.close();

// Screenshot 2: Graph explorer
console.log("Navigating to graph explorer...");
const graphPage = await browser.newPage("http://localhost:8765/graph/");
// Wait for graph to render
await new Promise((r) => setTimeout(r, 5000));
console.log("Taking graph explorer screenshot...");
await graphPage.screenshot({
  path:
    "/Users/nigel/auto-issue-work/NEAT-AI-Explore/docs/evidence/graph-synapse-colours.png",
});
console.log("Saved graph-synapse-colours.png");
await graphPage.close();

await browser.close();
console.log("Done!");
