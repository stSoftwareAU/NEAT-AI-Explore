function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/first_fetch_race_test.ts -> repo root
  const root = here.replace(/\/tests\/first_fetch_race_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("service worker registers (and is awaited) before app auto-load runs (Issue #22, 28-Dec-2025)", async () => {
  const indexPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(indexPath);

  // We want SW registration to begin before the app module executes, otherwise
  // the default snapshot auto-fetch can run before the SW is ready, leading to
  // a first-load fetch failure that succeeds on manual retry.
  const swRegisterIdx = html.indexOf("navigator.serviceWorker.register");
  const swReadyIdx = html.indexOf("navigator.serviceWorker.ready");
  const appImportIdx = html.indexOf('import("./app.js?v=__BUILD_ID__")');

  assert(
    swRegisterIdx !== -1,
    "Expected index.html to register a service worker",
  );
  assert(
    swReadyIdx !== -1,
    "Expected index.html to await navigator.serviceWorker.ready",
  );
  assert(
    appImportIdx !== -1,
    "Expected index.html to import app.js as a module",
  );

  assert(
    swRegisterIdx < appImportIdx,
    "Expected service worker registration to occur before importing app.js",
  );
  assert(
    swReadyIdx < appImportIdx,
    "Expected service worker readiness to be awaited before importing app.js",
  );
});
