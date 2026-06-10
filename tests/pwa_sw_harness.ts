/**
 * Test harness for the docs/ Service Worker (Issue #330).
 *
 * These helpers let tests assert on the Service Worker's *observable
 * behaviour* — what it precaches and how it routes navigations — instead of
 * grepping its source text. A behaviour-preserving refactor of sw.js (renaming
 * a constant, reordering STATIC_FILES, changing quote style) keeps these green.
 */

/** Parse the STATIC_FILES array from sw.js source into resolved paths.
 *
 * Paths may be plain strings (`"./index.html"`) or template literals carrying
 * a cache-busting query (`` `./app.js?v=${VERSION}` ``). The query suffix is
 * stripped so callers compare against stable, resolved paths. */
export function parseStaticFiles(swSource: string): string[] {
  const paths: string[] = [];
  const re = /["'`](\.\/.+?)(?:\?[^"'`]*)?["'`]/g;
  const startIdx = swSource.indexOf("const STATIC_FILES");
  const endIdx = swSource.indexOf("];", startIdx);
  if (startIdx < 0 || endIdx < 0) return paths;
  const block = swSource.slice(startIdx, endIdx + 2);
  let m;
  while ((m = re.exec(block)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

/** A minimal fake `event` for driving the SW's fetch handler. */
interface FakeFetchEvent {
  request: {
    url: string;
    method: string;
    mode: string;
    headers: Headers;
  };
  respondWith: (response: Promise<Response>) => void;
}

/** A loaded Service Worker instance with its registered listeners. */
export interface LoadedServiceWorker {
  /** Drive a navigation request and resolve to the served shell's path. */
  resolveNavigation(pathname: string): Promise<string>;
}

/**
 * Evaluate sw.js source in a sandboxed scope with stubbed worker globals and
 * return a handle for exercising its `fetch` listener.
 *
 * The `caches.match()` stub echoes the requested resource back as the response
 * body, so a navigation's served shell can be read off the response text.
 */
export function loadServiceWorker(
  swSource: string,
  origin = "https://neat.test",
): LoadedServiceWorker {
  const listeners: Record<string, (event: FakeFetchEvent) => void> = {};

  const fakeSelf = {
    location: { origin },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (type: string, fn: (event: FakeFetchEvent) => void) => {
      listeners[type] = fn;
    },
  };

  // caches.match echoes the requested resource so the served shell is readable.
  const fakeCaches = {
    match: (request: string | { url: string }) =>
      Promise.resolve(
        new Response(typeof request === "string" ? request : request.url),
      ),
    open: () =>
      Promise.resolve({
        put: () => {},
        add: () => Promise.resolve(),
        match: () => Promise.resolve(undefined),
      }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  };

  const fakeFetch = () => Promise.resolve(new Response("network"));

  // sw.js declares its constants/functions as locals inside this function body
  // and registers listeners on the injected `self`. URL/Response/Headers
  // resolve to the Deno globals.
  const evaluate = new Function("self", "caches", "fetch", swSource);
  evaluate(fakeSelf, fakeCaches, fakeFetch);

  return {
    async resolveNavigation(pathname: string): Promise<string> {
      const fetchListener = listeners.fetch;
      if (!fetchListener) throw new Error("sw.js registered no fetch listener");
      let captured: Promise<Response> | undefined;
      fetchListener({
        request: {
          url: origin + pathname,
          method: "GET",
          mode: "navigate",
          headers: new Headers(),
        },
        respondWith: (response) => {
          captured = response;
        },
      });
      if (!captured) {
        throw new Error(
          "fetch handler did not call respondWith for navigation",
        );
      }
      const response = await captured;
      return await response.text();
    },
  };
}
