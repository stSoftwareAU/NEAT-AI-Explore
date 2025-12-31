function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_focus_label_dedup_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_focus_label_dedup_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("starfield avoids duplicating the focus label (badge is sufficient) (Issue #44, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("focus already appears in the top-centre focus badge"),
    "Expected graph.js to document focus-label deduping to reduce visual noise",
  );
});
