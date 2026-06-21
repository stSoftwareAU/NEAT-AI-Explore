import { assertEquals } from "./test_helpers.ts";
import { fromFileUrl } from "@std/path";

// Issue #363: the licence must be declared in deno.json so manifest-reading
// tooling (JSR, SBOM, dependency-graph generators) can see it and it stays in
// agreement with the LICENSE file.

const denoJsonPath = fromFileUrl(new URL("../deno.json", import.meta.url));

async function readDenoJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(denoJsonPath));
}

Deno.test("deno.json declares the Apache-2.0 licence", async () => {
  const manifest = await readDenoJson();
  assertEquals(
    manifest.license,
    "Apache-2.0",
    "Expected deno.json to declare the SPDX licence Apache-2.0",
  );
});

Deno.test("deno.json licence matches the LICENSE file (Apache 2.0)", async () => {
  const manifest = await readDenoJson();
  const licensePath = fromFileUrl(new URL("../LICENSE", import.meta.url));
  const licenseText = await Deno.readTextFile(licensePath);
  const isApache = /Apache License\s+Version 2\.0/.test(licenseText);
  assertEquals(
    manifest.license === "Apache-2.0" && isApache,
    true,
    "deno.json licence must agree with the Apache 2.0 LICENSE file",
  );
});
