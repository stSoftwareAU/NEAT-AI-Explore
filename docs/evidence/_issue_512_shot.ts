import { launch } from "@astral/astral";

const OUT = new URL(
  "./observation-contributions-label-width.png",
  import.meta.url,
);
const browser = await launch();
const page = await browser.newPage(
  "http://localhost:8791/evidence/_issue_512_harness.html",
);
await new Promise((r) => setTimeout(r, 1500));
const shot = await page.screenshot({ format: "png" });
await Deno.writeFile(OUT, shot);
console.log("saved", OUT.pathname);
await page.close();
await browser.close();
