function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/graph_cable_synapses_test.ts -> repo root
  const root = here.replace(/\/tests\/graph_cable_synapses_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("graph renders synapses as curved cable polylines (Issue #44, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // We want synapses to read as cables, not straight laser lines. A pragmatic v1
  // is to approximate a curve with multiple GL line segments.
  assert(
    js.includes("appendCurvedEdge") || js.includes("CURVE_SEGMENTS"),
    "Expected graph.js to define a helper for curved edge polylines (appendCurvedEdge/CURVE_SEGMENTS)",
  );
  assert(
    js.includes("CURVE_SEGMENTS") ||
      /for\s*\(let\s+s\s*=\s*0;\s*s\s*<\s*\d+\s*;\s*s\+\+\)/.test(js),
    "Expected graph.js to iterate segments when building synapse geometry (polyline approximation)",
  );
});
