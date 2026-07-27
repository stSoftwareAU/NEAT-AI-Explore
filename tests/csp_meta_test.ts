/**
 * Tests for Issue #218: Content-Security-Policy meta on deployed PWA entry HTML.
 *
 * GitHub Pages does not set CSP response headers, so each app-shell HTML must
 * declare its policy via `<meta http-equiv="Content-Security-Policy">`. These
 * tests pin the directives so future contributors do not silently regress the
 * defence-in-depth surface (e.g. by reintroducing inline scripts, loosening
 * `connect-src`, or removing `frame-ancestors`).
 *
 * The CSP must stay in sync with `docs/shared/config.js`
 * `ALLOWED_SNAPSHOT_ORIGINS` (mirrored locally in `docs/sw.js`).
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { ALLOWED_SNAPSHOT_ORIGINS } from "../docs/shared/config.js";

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/csp_meta_test\.ts$/, "");
  return [root, ...parts].join("/");
}

const ENTRY_HTMLS = [
  repoPath("docs", "index.html"),
  repoPath("docs", "graph", "index.html"),
  repoPath("docs", "starfield", "index.html"),
  repoPath("docs", "dag", "index.html"),
];

/**
 * Extract the CSP meta content attribute (whitespace-collapsed) from an HTML
 * source string. Returns null if no CSP meta is declared.
 */
function extractCspContent(html: string): string | null {
  // Match <meta http-equiv="Content-Security-Policy" content="..."> in either
  // attribute order, allowing newlines inside the content attribute.
  const re =
    /<meta\s+(?:http-equiv\s*=\s*"Content-Security-Policy"\s+content\s*=\s*"([\s\S]*?)"|content\s*=\s*"([\s\S]*?)"\s+http-equiv\s*=\s*"Content-Security-Policy")\s*\/?>/i;
  const match = re.exec(html);
  if (!match) return null;
  const raw = match[1] ?? match[2] ?? "";
  return raw.replace(/\s+/g, " ").trim();
}

/** Parse a CSP string into a {directive: tokens[]} map. */
function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const name = tokens[0].toLowerCase();
    out[name] = tokens.slice(1);
  }
  return out;
}

for (const htmlPath of ENTRY_HTMLS) {
  const shortName = htmlPath.split("/docs/").pop();

  Deno.test(`CSP meta is declared in ${shortName}`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const csp = extractCspContent(html);
    assert(
      csp !== null,
      `Expected ${shortName} to declare a <meta http-equiv="Content-Security-Policy"> tag`,
    );
  });

  Deno.test(`CSP in ${shortName} restricts default-src to 'self'`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    assert(
      directives["default-src"]?.includes("'self'"),
      `${shortName} default-src must include 'self' (got ${
        JSON.stringify(directives["default-src"])
      })`,
    );
  });

  Deno.test(`CSP in ${shortName} forbids inline scripts (script-src 'self' only)`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    const scriptSrc = directives["script-src"] ?? [];
    assert(
      scriptSrc.includes("'self'"),
      `${shortName} script-src must include 'self'`,
    );
    assert(
      !scriptSrc.includes("'unsafe-inline'"),
      `${shortName} script-src must NOT allow 'unsafe-inline' (defeats XSS containment)`,
    );
    assert(
      !scriptSrc.includes("'unsafe-eval'"),
      `${shortName} script-src must NOT allow 'unsafe-eval'`,
    );
  });

  Deno.test(`CSP in ${shortName} mirrors ALLOWED_SNAPSHOT_ORIGINS in connect-src`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    const connectSrc = directives["connect-src"] ?? [];
    assert(
      connectSrc.includes("'self'"),
      `${shortName} connect-src must include 'self'`,
    );
    for (const origin of ALLOWED_SNAPSHOT_ORIGINS) {
      assert(
        connectSrc.includes(origin),
        `${shortName} connect-src must include ${origin} (matches docs/shared/config.js ALLOWED_SNAPSHOT_ORIGINS)`,
      );
    }
    // No wildcard egress.
    assert(
      !connectSrc.includes("*"),
      `${shortName} connect-src must not allow wildcard '*'`,
    );
  });

  Deno.test(`CSP in ${shortName} omits meta-ignored directives (CSP3 §3.4)`, async () => {
    // frame-ancestors, sandbox, and report-uri are spec'd to be ignored when
    // delivered via a <meta> tag. Including them produces a console warning
    // and gives a false sense of protection. They must be omitted here —
    // clickjacking guards must come from HTTP response headers (not possible
    // on GitHub Pages today).
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    for (const banned of ["frame-ancestors", "sandbox", "report-uri"]) {
      assert(
        !(banned in directives),
        `${shortName} CSP must not include '${banned}' in a meta-delivered policy (it is ignored per CSP3 §3.4 and pollutes the console)`,
      );
    }
  });

  Deno.test(`CSP in ${shortName} locks base-uri to 'self' (base-tag injection guard)`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    assert(
      directives["base-uri"]?.includes("'self'"),
      `${shortName} base-uri must include 'self'`,
    );
  });

  Deno.test(`CSP in ${shortName} sets form-action 'none' (no form submissions)`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    const tokens = directives["form-action"] ?? [];
    assert(
      tokens.length === 1 && tokens[0] === "'none'",
      `${shortName} form-action must be exactly 'none' (got ${
        JSON.stringify(tokens)
      })`,
    );
  });

  Deno.test(`CSP in ${shortName} allows img blobs and data URIs`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    const imgSrc = directives["img-src"] ?? [];
    assert(
      imgSrc.includes("'self'"),
      `${shortName} img-src must include 'self'`,
    );
    assert(imgSrc.includes("data:"), `${shortName} img-src must include data:`);
    assert(imgSrc.includes("blob:"), `${shortName} img-src must include blob:`);
  });

  Deno.test(`CSP in ${shortName} restricts worker-src and manifest-src to 'self'`, async () => {
    const html = await Deno.readTextFile(htmlPath);
    const directives = parseCsp(extractCspContent(html)!);
    assert(
      directives["worker-src"]?.includes("'self'"),
      `${shortName} worker-src must include 'self'`,
    );
    assert(
      directives["manifest-src"]?.includes("'self'"),
      `${shortName} manifest-src must include 'self'`,
    );
  });

  Deno.test(`${shortName} has no inline <script> blocks (CSP script-src 'self' compliance)`, async () => {
    let html = await Deno.readTextFile(htmlPath);
    // Strip HTML comments first — they may legitimately mention the literal
    // characters "<script>" in prose without that counting as an inline block.
    html = html.replace(/<!--[\s\S]*?-->/g, "");
    // Match any <script> tag that has body content between the opening and
    // closing tags. Self-closing or src-only tags are fine.
    const inlineScriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    const violations: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = inlineScriptRe.exec(html)) !== null) {
      const body = m[1].trim();
      if (body.length > 0) {
        violations.push(body.slice(0, 80));
      }
    }
    assertEquals(
      violations.length,
      0,
      `${shortName} must not contain inline <script> bodies (move to boot.js). Found: ${
        JSON.stringify(violations)
      }`,
    );
  });
}
