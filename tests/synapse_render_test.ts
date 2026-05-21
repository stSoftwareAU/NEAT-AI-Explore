/**
 * Tests for docs/shared/synapse_render.js (Issue #188).
 *
 * Regression coverage for the stored XSS in the inbound synapse list:
 * the source neuron's `type` field comes from snapshot JSON loaded from
 * a URL the visitor can be persuaded to supply, and was previously
 * interpolated into `innerHTML` without escaping. Every snapshot-derived
 * string in the "synapseFrom" cell must be HTML-escaped.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import { buildSynapseFromCellHtml } from "../docs/shared/synapse_render.js";

Deno.test("buildSynapseFromCellHtml escapes neuron type", () => {
  const html = buildSynapseFromCellHtml(
    `<span class="neuronUuid">input-0</span>`,
    "<img src=x onerror=alert(1)>",
  );
  // The attacker payload must not appear verbatim — the angle brackets
  // and equals signs must be escaped.
  assert(
    !html.includes("<img src=x onerror=alert(1)>"),
    "raw payload must not be present in output",
  );
  assert(
    html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "payload must be HTML-escaped",
  );
});

Deno.test("buildSynapseFromCellHtml escapes ampersands and quotes in type", () => {
  const html = buildSynapseFromCellHtml(
    `<span class="neuronUuid">u</span>`,
    `a & b "c" 'd'`,
  );
  assert(html.includes("a &amp; b &quot;c&quot; &#39;d&#39;"));
});

Deno.test("buildSynapseFromCellHtml preserves trusted nameHtml", () => {
  // nameHtml is built by the caller from already-escaped snapshot strings,
  // so the helper must not double-escape it.
  const nameHtml = `<span class="neuronUuid">input-0</span>`;
  const html = buildSynapseFromCellHtml(nameHtml, "input");
  assert(html.includes(nameHtml), "nameHtml should be passed through verbatim");
  assert(
    html.includes(`<span class="neuronType">input</span>`),
    "well-known type values render as a plain span",
  );
});

Deno.test("buildSynapseFromCellHtml coerces non-string type", () => {
  const html = buildSynapseFromCellHtml(`x`, null);
  assert(html.includes(`<span class="neuronType">null</span>`));
});

Deno.test("buildSynapseFromCellHtml wraps in synapseFrom container", () => {
  const html = buildSynapseFromCellHtml("name", "hidden");
  // Sanity: the result contains the structural wrapper used by the CSS.
  assertEquals(html.startsWith(`<div class="synapseFrom">`), true);
  assertEquals(html.trimEnd().endsWith(`</div>`), true);
});
