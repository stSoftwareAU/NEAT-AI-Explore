/**
 * Regression test for Issue #200 — "app completely broken, can't fetch model".
 *
 * The browser's module loader rejects an ES module that declares the same
 * imported identifier twice (e.g. importing `formatTraceScore` from two
 * different paths). When that happens to `docs/app.js`, the whole PWA fails
 * to boot, the default snapshot is never fetched, and the user sees the
 * status stuck on "Loading…" — exactly the symptom reported in #200.
 *
 * This test exercises the real module-load path: it stubs the browser globals
 * `docs/app.js` touches at the top level, dynamically imports the module, and
 * asserts that no `SyntaxError` is raised. Other errors (e.g. DOM stubs not
 * being rich enough to satisfy deep initialisation) are tolerated — the only
 * thing we care about is that the module *parses and links* cleanly.
 */

import { assert } from "./test_helpers.ts";

/** Build a permissive Proxy stub for DOM-ish globals. */
// deno-lint-ignore no-explicit-any
function makeStub(): any {
  // deno-lint-ignore no-explicit-any
  const target: any = function () {};
  return new Proxy(target, {
    get: () => makeStub(),
    apply: () => makeStub(),
    construct: () => makeStub(),
    set: () => true,
  });
}

/**
 * Import an entry module with browser globals stubbed, returning whatever it
 * threw (or null). Only a SyntaxError matters — anything else is a limit of
 * the stubs, not a defect in the module.
 */
async function importWithBrowserStubs(relativePath: string): Promise<unknown> {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const saved = {
    window: g.window,
    document: g.document,
    navigator: g.navigator,
    location: g.location,
    localStorage: g.localStorage,
    sessionStorage: g.sessionStorage,
    matchMedia: g.matchMedia,
    history: g.history,
    HTMLAnchorElement: g.HTMLAnchorElement,
  };

  g.window = g;
  g.document = makeStub();
  g.navigator = makeStub();
  g.location = new URL("https://example.com/");
  g.localStorage = makeStub();
  g.sessionStorage = makeStub();
  g.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  g.history = makeStub();
  // app.js uses `instanceof HTMLAnchorElement` — keep it a class so the check
  // does not blow up at link time. Anything that isn't an instance will simply
  // return false, which is fine for this smoke test.
  g.HTMLAnchorElement = class {};

  let caught: unknown = null;
  try {
    // Cache-bust so retries inside the same test process do not reuse a stale
    // failed module record.
    const url = new URL(
      `${relativePath}?test=${Date.now()}`,
      import.meta.url,
    ).href;
    await import(url);
  } catch (e) {
    caught = e;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  }
  return caught;
}

// Entry modules whose parse/link failure would leave the page stuck on
// "Loading…" in the browser. docs/dag/dag.js was added with Issue #525.
const ENTRY_MODULES = [
  "../docs/app.js",
  "../docs/dag/dag.js",
  "../docs/subgraph/subgraph.js",
];

for (const relativePath of ENTRY_MODULES) {
  Deno.test(`${relativePath} loads without SyntaxError (Issue #200)`, async () => {
    const caught = await importWithBrowserStubs(relativePath);

    // A SyntaxError means the module itself is malformed (e.g. duplicate
    // import identifier) — that is the regression we care about. Any other
    // error type is a stubbing limitation and is ignored.
    if (caught instanceof SyntaxError) {
      throw new Error(
        `${relativePath} failed to parse: ${caught.message}`,
      );
    }

    // Always-true sanity check so the test reports as having run an assertion.
    assert(true);
  });
}
