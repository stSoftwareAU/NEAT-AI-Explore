function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Assertion failed: expected ${JSON.stringify(expected)} but got ${
          JSON.stringify(actual)
        }`,
    );
  }
}

function repoPath(...parts: string[]): string {
  const here = new URL(".", import.meta.url).pathname;
  // tests/* -> repo root
  const root = here.replace(/\/tests\/?$/, "");
  return [root, ...parts].join("/");
}

Deno.test("inbound TopK default is representable in the UI (or clamped)", async () => {
  const appJsPath = repoPath("docs", "app.js");
  const indexHtmlPath = repoPath("docs", "index.html");
  const [appJs, indexHtml] = await Promise.all([
    Deno.readTextFile(appJsPath),
    Deno.readTextFile(indexHtmlPath),
  ]);

  // Keep this test light-weight and robust: we only parse the narrow/wide
  // numeric defaults from `defaultInboundTopK()` and the numeric <option> values
  // within the synapseTopK <select>.
  const m = appJs.match(
    /function\s+defaultInboundTopK\(\)\s*\{[\s\S]*?return\s+isNarrowMobile\(\)\s*\?\s*(\d+)\s*:\s*(\d+)\s*;[\s\S]*?\}/,
  );
  assert(
    m,
    `Expected ${appJsPath} to define defaultInboundTopK() with ternary`,
  );
  const narrowDefault = Number(m[1]);
  const wideDefault = Number(m[2]);
  assert(Number.isFinite(narrowDefault) && narrowDefault > 0);
  assert(Number.isFinite(wideDefault) && wideDefault > 0);

  const selectStart = indexHtml.indexOf('<select id="synapseTopK"');
  assert(selectStart >= 0, `Expected ${indexHtmlPath} to include synapseTopK`);
  const selectEnd = indexHtml.indexOf("</select>", selectStart);
  assert(
    selectEnd > selectStart,
    `Expected ${indexHtmlPath} to close synapseTopK`,
  );
  const selectBlock = indexHtml.slice(selectStart, selectEnd);

  const optValues = Array.from(selectBlock.matchAll(/value="(\d+)"/g)).map((
    r,
  ) => Number(r[1]));
  assert(
    optValues.length >= 2,
    "Expected synapseTopK to have multiple options",
  );

  // Wide default should be directly selectable (desktop/tablet path).
  assert(
    optValues.includes(wideDefault),
    `Expected synapseTopK to include the wide default (${wideDefault})`,
  );

  // For iPhone we allow either:
  // - the narrow default exists as an option (e.g. 80), OR
  // - the app clamps invalid values to the closest supported option.
  const hasNarrowOption = optValues.includes(narrowDefault);
  const hasClampLogic = appJs.includes("Array.from(select.options") &&
    appJs.includes("select.value = String(best)") &&
    appJs.includes("inboundTopK = best");

  assert(
    hasNarrowOption || hasClampLogic,
    `Expected synapseTopK to include the narrow default (${narrowDefault}) or for ${appJsPath} to clamp invalid values.`,
  );

  // Sanity: ensure the test itself isn't accidentally passing due to empty parse.
  assertEquals(Number.isFinite(optValues[0]), true);
});
