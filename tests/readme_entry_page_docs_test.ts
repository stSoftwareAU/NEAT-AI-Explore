/**
 * Issue #632: every entry page under `docs/` must be documented in the README.
 *
 * `docs/compare/` shipped as a public entry point — linked from the Trace
 * explorer, precached by the service worker — while the README never told a
 * reader it existed. This gate discovers the entry pages from the filesystem
 * (the same way `tests/entry_page_pwa_wiring_test.ts` does), so a page added
 * in future without a README section fails here rather than silently becoming
 * an undocumented public surface.
 *
 * The check is structural, not a keyword grep over prose (#331): it asserts
 * the README refers to the page by its repository path (`docs/<dir>/`), which
 * every documented view already does.
 */

import { assert } from "./test_helpers.ts";

const DOCS_URL = new URL("../docs/", import.meta.url);
const README_URL = new URL("../README.md", import.meta.url);

/**
 * Entry pages that are intentionally documented under another page's section.
 *
 * `docs/starfield/starfield.js` is a deliberately thin alias that imports
 * `docs/graph/graph.js`, so the README's Graph explorer section covers it.
 */
const ALIAS_PAGES = new Set(["starfield"]);

/** Directory names under docs/ that serve their own index.html app shell. */
async function discoverEntryPageDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for await (const entry of Deno.readDir(DOCS_URL)) {
    if (!entry.isDirectory) continue;
    try {
      await Deno.stat(new URL(`${entry.name}/index.html`, DOCS_URL));
    } catch {
      continue; // Not an entry page (icons/, shared/, archive/, …).
    }
    dirs.push(entry.name);
  }
  return dirs.sort();
}

Deno.test("README documents every entry page under docs/", async () => {
  const dirs = await discoverEntryPageDirs();
  assert(dirs.length > 0, "expected at least one entry page under docs/");

  const readme = await Deno.readTextFile(README_URL);
  const undocumented = dirs.filter((dir) =>
    !ALIAS_PAGES.has(dir) && !readme.includes(`docs/${dir}/`)
  );

  assert(
    undocumented.length === 0,
    `README.md never mentions ${
      undocumented.map((dir) => `docs/${dir}/`).join(", ")
    } — every entry page needs a usage section naming its entry point`,
  );
});

Deno.test("README documents the compare page's launcher role", async () => {
  const readme = await Deno.readTextFile(README_URL);

  assert(
    readme.includes("docs/compare/index.html"),
    "README.md should name the compare entry point docs/compare/index.html",
  );
  for (const candidate of ["/dag/", "/sankey/", "/subgraph/"]) {
    assert(
      readme.includes(candidate),
      `README.md should name the ${candidate} candidate the compare page launches`,
    );
  }
});
