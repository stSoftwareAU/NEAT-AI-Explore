function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/safe_area_padding_test.ts -> repo root
  const root = here.replace(/\/tests\/safe_area_padding_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("520px breakpoint preserves safe-area padding for notched devices", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // iPhones sit inside the 520px breakpoint, so we must not overwrite the
  // safe-area padding we add for notched devices.
  assert(
    css.includes("@media (max-width: 520px)"),
    `Expected ${p} to include the max-width: 520px breakpoint`,
  );

  // We don't parse CSS here; this is a smoke test that the 520px rules include
  // env(safe-area-inset-*) adjustments (usually via calc(... + env(...))).
  // If these strings disappear, it likely means notch handling regressed.
  assert(
    css.includes("@media (max-width: 520px)") &&
      css.includes("safe-area-inset-top") &&
      css.includes("safe-area-inset-left") &&
      css.includes("safe-area-inset-right") &&
      css.includes("calc(10px + env(safe-area-inset-top))"),
    `Expected ${p} to incorporate safe-area env() padding within the 520px breakpoint`,
  );
});
