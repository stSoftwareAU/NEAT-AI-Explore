function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_synapse_rendering_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_synapse_rendering_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("starfield shows focus + synapse links + aliases (Issue #25)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const htmlPath = repoPath("docs", "starfield", "index.html");

  const js = await Deno.readTextFile(jsPath);
  const html = await Deno.readTextFile(htmlPath);

  // Aliases from snapshot.tooltips.
  assert(
    js.includes("snapshot?.tooltips") || js.includes("loadLabelsFromSnapshot"),
    `Expected ${jsPath} to load aliases/descriptions from snapshot.tooltips`,
  );
  assert(
    js.includes("uuidToLabel") && js.includes("getAlias"),
    `Expected ${jsPath} to keep a uuid->label mapping and use it in the UI`,
  );

  // Focus indicator in the UI.
  assert(
    html.includes('id="focusBadge"'),
    `Expected ${htmlPath} to include a focus badge element`,
  );
  assert(
    html.includes('id="labelOverlay"'),
    `Expected ${htmlPath} to include a label overlay element`,
  );
  assert(
    html.includes('id="modeToggle"'),
    `Expected ${htmlPath} to include a mode toggle (Impact/Links)`,
  );
  assert(
    js.includes("updateLabelsForFocus") && js.includes("labelText("),
    `Expected ${jsPath} to project labels for focus/neighbours using alias or short UUID`,
  );

  // Synapse rendering (WebGL lines).
  assert(
    js.includes("gl.LINES") && js.includes("updateLines"),
    `Expected ${jsPath} to render synapse links as WebGL lines`,
  );

  // Impact flow mode should reuse the Explorer's inbound allocation helper.
  assert(
    js.includes("computeInboundSynapseImpactAllocation"),
    `Expected ${jsPath} to use computeInboundSynapseImpactAllocation for Impact Flow mode`,
  );

  // Synapse stats: weight + derived mean contribution when available.
  assert(
    js.includes("meanContribution") || js.includes("mean_contribution"),
    `Expected ${jsPath} to read meanContribution from snapshot.derived.synapses`,
  );
  assert(
    js.includes("weight") && js.includes("edgeStrength01"),
    `Expected ${jsPath} to compute line strength from |meanContribution| or |weight|`,
  );
});
