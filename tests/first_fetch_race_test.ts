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
  //
  // Regression guard (Issue #23, 29-Dec-2025): `navigator.serviceWorker.ready`
  // never rejects and can wait indefinitely if installation/activation fails.
  // We must use a timeout so the app still starts in degraded mode.
  const swRegisterIdx = html.indexOf("navigator.serviceWorker.register");
  const swReadyIdx = html.indexOf("navigator.serviceWorker.ready");
  const promiseRaceIdx = html.indexOf("Promise.race");
  const setTimeoutIdx = html.indexOf("setTimeout");
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
    promiseRaceIdx !== -1,
    "Expected index.html to use Promise.race for SW readiness timeout",
  );
  assert(
    setTimeoutIdx !== -1,
    "Expected index.html to use setTimeout for SW readiness timeout",
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
  assert(
    promiseRaceIdx < appImportIdx,
    "Expected SW readiness timeout logic to occur before importing app.js",
  );
});

Deno.test("service worker registers (and is awaited) before graph explorer auto-load runs (31-Dec-2025)", async () => {
  const indexPath = repoPath("docs", "graph", "index.html");
  const html = await Deno.readTextFile(indexPath);

  // The graph explorer also auto-loads the default snapshot on boot,
  // so it must give the service worker time to install/activate before the
  // first fetch runs (especially on iOS/PWA).
  const swRegisterIdx = html.indexOf("navigator.serviceWorker.register");
  const swReadyIdx = html.indexOf("navigator.serviceWorker.ready");
  const promiseRaceIdx = html.indexOf("Promise.race");
  const setTimeoutIdx = html.indexOf("setTimeout");
  const appImportIdx = html.indexOf('import("./graph.js?v=__BUILD_ID__")');

  assert(
    swRegisterIdx !== -1,
    "Expected graph/index.html to register a service worker",
  );
  assert(
    swReadyIdx !== -1,
    "Expected graph/index.html to await navigator.serviceWorker.ready",
  );
  assert(
    promiseRaceIdx !== -1,
    "Expected graph/index.html to use Promise.race for SW readiness timeout",
  );
  assert(
    setTimeoutIdx !== -1,
    "Expected graph/index.html to use setTimeout for SW readiness timeout",
  );
  assert(
    appImportIdx !== -1,
    "Expected graph/index.html to import graph.js as a module",
  );

  assert(
    swRegisterIdx < appImportIdx,
    "Expected service worker registration to occur before importing graph.js",
  );
  assert(
    swReadyIdx < appImportIdx,
    "Expected service worker readiness to be awaited before importing graph.js",
  );
  assert(
    promiseRaceIdx < appImportIdx,
    "Expected SW readiness timeout logic to occur before importing graph.js",
  );
});
