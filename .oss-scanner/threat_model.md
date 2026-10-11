# Threat model

Short brief for the scanner. Reporting and supply-chain policy is in
[SECURITY.md](../SECURITY.md); the app and its views are described in
[README.md](../README.md).

## What this project does and where untrusted input enters

NEAT-AI Explore is a static, client-side PWA (progressive web app) that renders
NEAT-AI creature snapshots in the browser. It is served from GitHub Pages out of
`docs/`; there is no server, no login and no stored user data. Treat as
untrusted:

- snapshot JSON (`snapshot.json.gz` or `.json`) fetched from a URL, including
  the default NEAT-AI-Snapshot host and any URL given by the `snapshotUrl`,
  `snapshotUrlB64`, `url` or `file` query parameters. Anyone can send a victim a
  link, and the CSP (Content Security Policy) `connect-src` allows
  `raw.githubusercontent.com`, which serves anyone's content;
- files the user opens through the `<input type="file">` pickers;
- every string inside a snapshot: neuron labels, UUIDs, squash names, tags,
  observation names and discovery or diagnostics text;
- responses held in the service worker's caches.

## Components that matter most / least

Most important:

- the snapshot loader and gunzip path (`docs/shared/snapshot_loader.js`,
  `docs/vendor/fflate.browser.js`): URL scheme checks, decompression bombs,
  unbounded memory use;
- DOM rendering of snapshot strings: every `innerHTML` site in `docs/app.js`,
  `docs/graph/`, `docs/sankey/`, `docs/dag/`, `docs/subgraph/` and
  `docs/shared/` must go through `escapeHtml` (`docs/shared/ui_helpers.js`);
- prototype pollution when snapshot keys are copied into objects or maps;
- the service worker (`docs/sw.js`) and its snapshot-origin allowlist (kept in
  sync with `docs/shared/config.js`): cache poisoning or serving a cross-origin
  response as app shell;
- the CSP meta tags in each `docs/**/index.html` (`script-src 'self'`).

Lower priority: `scripts/` (evidence capture, asset generation, ruleset and
quarantine checks run by maintainers or CI), `helpers/server.ts` (local dev
server only) and `quality/` shell gates.

## How to exercise it

From `/src`: `deno test -A --reporter=dot` runs the suite (about 130 files under
`tests/`, mostly DOM-free module tests with `@b-fuze/deno-dom`);
`tests/snapshot_loader*_test.ts`, `tests/csp_meta_test.ts` and
`tests/pwa_test.ts` are the closest to the trust boundary.
`deno check helpers/
scripts/ tests/ docs/` type-checks everything. No browser
is installed in the image, so reproduce DOM issues with a deno-dom test or a
crafted snapshot.

## How you rate severity

- Critical: script execution in the app origin from a crafted snapshot or link
  (XSS that bypasses the CSP), or a service-worker cache poisoning that persists
  attacker script across reloads.
- High: XSS that the CSP blocks but that injects markup, links or forms; loading
  a snapshot from an origin outside the allowlist; prototype pollution that
  changes app behaviour.
- Medium: denial of service of the tab (decompression bomb, pathological
  topology that hangs layout), or leaking local preferences.
- Low: issues that need the user to load a file they built themselves, or that
  need a compromised GitHub Pages host.

## Anything to leave alone

- Vendored `docs/vendor/fflate.browser.js` is third-party; report it only when
  the way this app calls it is exploitable.
- `docs/archive/` and `docs/evidence/` are historical PR summaries and
  screenshots, not shipped code paths.
- `style-src 'unsafe-inline'` in the CSP is a known trade-off.
