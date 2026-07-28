import { assert, assertEquals } from "./test_helpers.ts";
import { loadServiceWorker, parseStaticFiles } from "./pwa_sw_harness.ts";

/**
 * Issue #549: every entry page under docs/ must be wired into the PWA
 * plumbing — Service Worker navigation routing, the STATIC_FILES precache
 * list, and the build-ID inject list.
 *
 * PR #548 added docs/compare/ and docs/sankey/ without any of the three, so
 * /compare/ was served the root Explorer shell (whose relative asset URLs then
 * 404) and the literal `__BUILD_ID__` placeholder shipped to production.
 *
 * These gates discover the entry pages from the filesystem rather than from a
 * hard-coded list, so a page added in future without PWA wiring fails here —
 * locally and in CI — instead of deploying green.
 */

const DOCS_URL = new URL("../docs/", import.meta.url);

function docsPath(rel = ""): string {
  return new URL(rel, DOCS_URL).pathname;
}

/** An entry page: a directory under docs/ that serves its own index.html. */
interface EntryPage {
  /** Directory name, or "" for the root Explorer shell. */
  dir: string;
  /** Navigation path a browser would request, e.g. "/compare/". */
  route: string;
  /** SW-relative shell path, e.g. "./compare/index.html". */
  shell: string;
}

/** Discover every entry page under docs/ (root plus one level of directories). */
async function discoverEntryPages(): Promise<EntryPage[]> {
  const pages: EntryPage[] = [
    { dir: "", route: "/", shell: "./index.html" },
  ];
  for await (const entry of Deno.readDir(docsPath())) {
    if (!entry.isDirectory) continue;
    try {
      await Deno.stat(docsPath(`${entry.name}/index.html`));
    } catch {
      continue; // Not an entry page (icons/, shared/, archive/, …).
    }
    pages.push({
      dir: entry.name,
      route: `/${entry.name}/`,
      shell: `./${entry.name}/index.html`,
    });
  }
  return pages.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Page-local .js/.css assets that live beside an entry page's index.html. */
async function pageLocalAssets(page: EntryPage): Promise<string[]> {
  if (page.dir === "") return [];
  const assets: string[] = [];
  for await (const entry of Deno.readDir(docsPath(page.dir))) {
    if (!entry.isFile) continue;
    if (!/\.(js|css)$/.test(entry.name)) continue;
    assets.push(`./${page.dir}/${entry.name}`);
  }
  return assets.sort();
}

/** Every docs/ source file carrying the `__BUILD_ID__` placeholder. */
async function discoverPlaceholderFiles(dir = ""): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(docsPath(dir))) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    // archive/ holds historical PR summaries that quote the placeholder as
    // prose; vendor/ is third-party code that is never rewritten.
    if (entry.isDirectory) {
      if (rel === "archive" || rel === "vendor") continue;
      found.push(...await discoverPlaceholderFiles(rel));
      continue;
    }
    if (!entry.isFile) continue;
    if (!/\.(html|js|css)$/.test(entry.name)) continue;
    const source = await Deno.readTextFile(docsPath(rel));
    if (source.includes("__BUILD_ID__")) found.push(`docs/${rel}`);
  }
  return found.sort();
}

Deno.test("SW navigation routes every docs/ entry page to its own shell (#549)", async () => {
  const swSource = await Deno.readTextFile(docsPath("sw.js"));
  const sw = loadServiceWorker(swSource);
  const pages = await discoverEntryPages();

  for (const page of pages) {
    assertEquals(
      await sw.resolveNavigation(page.route),
      page.shell,
      `navigating to ${page.route} must serve ${page.shell} — add it to the ` +
        `navigation shell map in docs/sw.js, or the root Explorer shell is ` +
        `served and its relative asset URLs 404`,
    );
  }
});

Deno.test("SW STATIC_FILES precaches every entry page and its local assets (#549)", async () => {
  const swSource = await Deno.readTextFile(docsPath("sw.js"));
  const staticFiles = parseStaticFiles(swSource);
  const pages = await discoverEntryPages();

  const missing: string[] = [];
  for (const page of pages) {
    if (!staticFiles.includes(page.shell)) missing.push(page.shell);
    for (const asset of await pageLocalAssets(page)) {
      if (!staticFiles.includes(asset)) missing.push(asset);
    }
  }

  assert(
    missing.length === 0,
    `sw.js STATIC_FILES is missing entry-page assets: ${
      missing.join(", ")
    }. Add them so each page is precached and invalidated on deploy.`,
  );
});

Deno.test("SW STATIC_FILES precaches shared modules imported by every entry page (#549)", async () => {
  const swSource = await Deno.readTextFile(docsPath("sw.js"));
  const staticFiles = parseStaticFiles(swSource);
  const pages = await discoverEntryPages();
  const re = /\bfrom\s+["'](\.[^"']+)["']/g;

  const missing = new Set<string>();
  for (const page of pages) {
    for (const asset of await pageLocalAssets(page)) {
      const source = await Deno.readTextFile(docsPath(asset.slice(2)));
      for (const [, spec] of source.matchAll(re)) {
        const shared = spec.replace(/^\.\.\/shared\//, "./shared/");
        if (!shared.startsWith("./shared/")) continue;
        if (!staticFiles.includes(shared)) missing.add(shared);
      }
    }
  }

  assert(
    missing.size === 0,
    `sw.js STATIC_FILES is missing shared modules imported by entry pages: ${
      [...missing].join(", ")
    }. Missing modules can be served stale by cacheFirst after a deploy.`,
  );
});

Deno.test("inject_build_id.ts rewrites every docs/ file carrying the placeholder (#549)", async () => {
  // Seed a fixture tree with exactly the docs/ files that really carry
  // `__BUILD_ID__`, run the real script over it, and assert none survive.
  // A page missing from the script's file list keeps its placeholder; a stale
  // entry in that list makes the script exit non-zero on the missing file.
  const buildId = "abc1234";
  const expected = await discoverPlaceholderFiles();
  assert(expected.length > 0, "expected docs/ to contain __BUILD_ID__ files");

  const tmp = await Deno.makeTempDir({ prefix: "entry_page_build_id_" });
  try {
    for (const rel of expected) {
      const abs = `${tmp}/${rel}`;
      await Deno.mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
      await Deno.writeTextFile(abs, `// version: __BUILD_ID__\n`);
    }

    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        new URL("../scripts/inject_build_id.ts", import.meta.url).pathname,
        buildId,
      ],
      cwd: tmp,
    });
    const { code, stderr } = await command.output();
    assertEquals(
      code,
      0,
      `inject_build_id.ts should exit 0, stderr: ${
        new TextDecoder().decode(stderr)
      }`,
    );

    const stale: string[] = [];
    for (const rel of expected) {
      const after = await Deno.readTextFile(`${tmp}/${rel}`);
      if (after.includes("__BUILD_ID__")) stale.push(rel);
    }
    assert(
      stale.length === 0,
      `these files still contain __BUILD_ID__ after injection: ${
        stale.join(", ")
      }. Add them to the files[] list in scripts/inject_build_id.ts.`,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
