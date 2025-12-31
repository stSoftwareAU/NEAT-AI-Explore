function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/server_script_test.ts -> repo root
  const root = here.replace(/\/tests\/server_script_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("helpers/server.sh exists and starts a Deno server", async () => {
  const p = repoPath("helpers", "server.sh");
  const text = await Deno.readTextFile(p);

  assert(text.includes("deno run"), "Expected helpers/server.sh to run deno");
  assert(
    text.includes("server.ts"),
    "Expected helpers/server.sh to reference server.ts",
  );
});

Deno.test("helpers/server.ts uses JSR std http file server", async () => {
  const p = repoPath("helpers", "server.ts");
  const text = await Deno.readTextFile(p);

  assert(
    text.includes("@std/http/file-server"),
    "Expected helpers/server.ts to import @std/http/file-server (via deno.json imports)",
  );
  assert(
    text.includes("spaEntryPointForPath") &&
      text.includes("/graph/index.html"),
    "Expected helpers/server.ts SPA fallback to route /graph/ to /graph/index.html",
  );
});

Deno.test("deno.json pins JSR std imports", async () => {
  const p = repoPath("deno.json");
  const obj = JSON.parse(await Deno.readTextFile(p));
  const imports = obj?.imports ?? {};

  assert(
    typeof imports["@std/http/file-server"] === "string" &&
      imports["@std/http/file-server"].startsWith("jsr:@std/http@"),
    "Expected deno.json imports to pin @std/http/file-server via jsr:@std/http@...",
  );
  assert(
    typeof imports["@std/path"] === "string" &&
      imports["@std/path"].startsWith("jsr:@std/path@"),
    "Expected deno.json imports to pin @std/path via jsr:@std/path@...",
  );
});
