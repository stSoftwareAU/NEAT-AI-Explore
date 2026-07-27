/**
 * Tests for Issue #424: each app-shell page must declare a distinct,
 * descriptive <title>.
 *
 * The <title> appears in the browser tab, history, and bookmarks, and is the
 * first thing a screen reader announces on page load. Two pages sharing one
 * title makes them indistinguishable in those lists. The Starfield page
 * previously reused the Graph page's title ("NEAT-AI Explore - Graph view");
 * these tests pin a unique title per page so the regression cannot return.
 */

import { assert, assertEquals } from "./test_helpers.ts";

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/page_title_test\.ts$/, "");
  return [root, ...parts].join("/");
}

/** The three published app-shell pages and their expected document titles. */
const PAGES: Array<{ path: string; title: string }> = [
  { path: repoPath("docs", "index.html"), title: "NEAT-AI Explore" },
  {
    path: repoPath("docs", "graph", "index.html"),
    title: "NEAT-AI Explore - Graph view",
  },
  {
    path: repoPath("docs", "starfield", "index.html"),
    title: "NEAT-AI Explore - Starfield view",
  },
  {
    path: repoPath("docs", "subgraph", "index.html"),
    title: "NEAT-AI Explore - Top-impact subgraph view",
  },
];

/** Extract the trimmed text content of the first <title> element. */
function extractTitle(html: string): string | null {
  const match = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].trim() : null;
}

for (const { path, title } of PAGES) {
  const shortName = path.split("/docs/").pop();

  Deno.test(`${shortName} declares the expected <title>`, async () => {
    const html = await Deno.readTextFile(path);
    assertEquals(
      extractTitle(html),
      title,
      `${shortName} must have <title>${title}</title>`,
    );
  });
}

Deno.test("app-shell pages have distinct titles", async () => {
  const titles = new Set<string>();
  for (const { path } of PAGES) {
    const html = await Deno.readTextFile(path);
    const title = extractTitle(html);
    assert(title !== null, `${path} is missing a <title>`);
    assert(
      !titles.has(title!),
      `Duplicate <title> "${title}" — each page must be uniquely identifiable`,
    );
    titles.add(title!);
  }
  assertEquals(titles.size, PAGES.length);
});
