/**
 * Tests for the Deno-native CycloneDX SBOM generator (#358).
 *
 * The generator reads the resolved dependency closure from `deno.lock` and
 * produces a CycloneDX 1.5 SBOM. These tests exercise the pure parsing and
 * assembly functions with representative lockfile fragments and assert on
 * the emitted component coordinates, purls, and integrity hashes.
 */

import {
  buildSbom,
  type DenoLock,
  integrityToHash,
  jsrPurl,
  lockToComponents,
  npmPurl,
  splitNameVersion,
} from "../scripts/generate_sbom.ts";
import { assert, assertEquals } from "./test_helpers.ts";

/** Deep equality via stable serialisation (the shared helper is `===` only). */
function assertDeepEquals(actual: unknown, expected: unknown, msg?: string) {
  assertEquals(JSON.stringify(actual), JSON.stringify(expected), msg);
}

Deno.test("splitNameVersion - unscoped name", () => {
  assertDeepEquals(splitNameVersion("left-pad@1.0.0"), {
    name: "left-pad",
    version: "1.0.0",
  });
});

Deno.test("splitNameVersion - scoped name keeps the scope", () => {
  assertDeepEquals(splitNameVersion("@std/cli@1.0.29"), {
    name: "@std/cli",
    version: "1.0.29",
  });
});

Deno.test("splitNameVersion - no version separator returns null", () => {
  assertEquals(splitNameVersion("@std/cli"), null);
});

Deno.test("npmPurl - unscoped", () => {
  assertEquals(npmPurl("jimp", "1.6.1"), "pkg:npm/jimp@1.6.1");
});

Deno.test("npmPurl - scoped name percent-encodes the scope", () => {
  assertEquals(npmPurl("@jimp/core", "1.6.1"), "pkg:npm/%40jimp/core@1.6.1");
});

Deno.test("jsrPurl - scoped name percent-encodes the scope", () => {
  assertEquals(jsrPurl("@std/cli", "1.0.29"), "pkg:jsr/%40std/cli@1.0.29");
});

Deno.test("integrityToHash - bare hex is treated as SHA-256", () => {
  const hex = "a".repeat(64);
  assertDeepEquals(integrityToHash(hex), { alg: "SHA-256", content: hex });
});

Deno.test("integrityToHash - sha512 SRI decodes base64 to hex", () => {
  // base64("hi") = "aGk=" → hex "6869"
  assertDeepEquals(integrityToHash("sha512-aGk="), {
    alg: "SHA-512",
    content: "6869",
  });
});

Deno.test("integrityToHash - empty / unrecognised returns null", () => {
  assertEquals(integrityToHash(undefined), null);
  assertEquals(integrityToHash(""), null);
  assertEquals(integrityToHash("not-a-hash"), null);
});

const SAMPLE_LOCK: DenoLock = {
  version: "5",
  jsr: {
    "@std/cli@1.0.29": { integrity: "f".repeat(64) },
    "@b-fuze/deno-dom@0.1.56": { integrity: "8".repeat(64) },
  },
  npm: {
    "jimp@1.6.1": { integrity: "sha512-aGk=" },
    "@jimp/core@1.6.1": {},
  },
};

Deno.test("lockToComponents - enumerates every jsr and npm entry", () => {
  const components = lockToComponents(SAMPLE_LOCK);
  assertEquals(components.length, 4);
});

Deno.test("lockToComponents - jsr components precede npm and are sorted", () => {
  const components = lockToComponents(SAMPLE_LOCK);
  assertEquals(components[0].ecosystem, "jsr");
  assertEquals(components[components.length - 1].ecosystem, "npm");
  // jsr block sorted by purl: @b-fuze before @std
  assertEquals(components[0].name, "@b-fuze/deno-dom");
  assertEquals(components[1].name, "@std/cli");
});

Deno.test("lockToComponents - carries purl, version and hash", () => {
  const components = lockToComponents(SAMPLE_LOCK);
  const jimp = components.find((c) => c.name === "jimp");
  assert(jimp, "expected a jimp component");
  assertEquals(jimp.version, "1.6.1");
  assertEquals(jimp.purl, "pkg:npm/jimp@1.6.1");
  assertEquals(jimp["bom-ref"], "pkg:npm/jimp@1.6.1");
  assertDeepEquals(jimp.hashes?.[0], { alg: "SHA-512", content: "6869" });
});

Deno.test("lockToComponents - omits hashes when integrity is absent", () => {
  const components = lockToComponents(SAMPLE_LOCK);
  const core = components.find((c) => c.name === "@jimp/core");
  assert(core, "expected a @jimp/core component");
  assertEquals(core.hashes, undefined);
});

Deno.test("buildSbom - emits a valid CycloneDX 1.5 envelope", () => {
  const bom = buildSbom(SAMPLE_LOCK, {
    name: "neat-ai-explore",
    version: "1.2.3",
  });
  assertEquals(bom.bomFormat, "CycloneDX");
  assertEquals(bom.specVersion, "1.5");
  assertEquals(bom.version, 1);
  assertEquals(bom.metadata.component.type, "application");
  assertEquals(bom.metadata.component.name, "neat-ai-explore");
  assertEquals(bom.metadata.component.version, "1.2.3");
  assertEquals(bom.components.length, 4);
});

Deno.test("buildSbom - components carry an ecosystem property", () => {
  const bom = buildSbom(SAMPLE_LOCK, { name: "app", version: "1.0.0" });
  const jimp = bom.components.find((c) => c.name === "jimp");
  assert(jimp, "expected jimp component");
  assertDeepEquals(jimp.properties[0], {
    name: "deno:ecosystem",
    value: "npm",
  });
});

Deno.test("buildSbom - optional timestamp and serial number are included", () => {
  const bom = buildSbom(SAMPLE_LOCK, { name: "app", version: "1.0.0" }, {
    timestamp: "2026-06-21T00:00:00.000Z",
    serialNumber: "urn:uuid:1234",
  });
  assertEquals(bom.metadata.timestamp, "2026-06-21T00:00:00.000Z");
  assertEquals(bom.serialNumber, "urn:uuid:1234");
});

Deno.test("buildSbom - empty lock yields zero components", () => {
  const bom = buildSbom({}, { name: "app", version: "1.0.0" });
  assertEquals(bom.components.length, 0);
});

Deno.test("buildSbom - generates a real SBOM from the repo deno.lock", async () => {
  const lock = JSON.parse(await Deno.readTextFile("deno.lock")) as DenoLock;
  const bom = buildSbom(lock, { name: "neat-ai-explore", version: "0.1.43" });
  // The repo ships both JSR and npm dependencies, so both must appear.
  assert(bom.components.length > 0, "expected components from deno.lock");
  assert(
    bom.components.some((c) => c.purl.startsWith("pkg:jsr/")),
    "expected at least one JSR component",
  );
  assert(
    bom.components.some((c) => c.purl.startsWith("pkg:npm/")),
    "expected at least one npm component",
  );
});
