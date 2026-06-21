/**
 * Tests for the repo SECURITY.md supply-chain readiness file (#356).
 *
 * SCR-RUNBOOK requires a single, discoverable SECURITY.md at the repo root
 * that documents (a) a private disclosure contact and (b) an emergency
 * dependency-bump procedure. GitHub also surfaces SECURITY.md in the
 * repository Security tab and the "Report a vulnerability" flow.
 *
 * Following the docs_floor_test.ts (#331) convention, the durable structural
 * check is that the file exists. The two content checks below assert on the
 * presence of the two *structural* sections the SCR-RUNBOOK class mandates
 * (a reporting/disclosure section and an emergency-bump section), not on exact
 * wording — so routine rewording does not break the suite.
 */

import { assert } from "./test_helpers.ts";

const SECURITY_PATH = new URL("../SECURITY.md", import.meta.url);

Deno.test("SECURITY.md exists at repo root", async () => {
  const stat = await Deno.stat(SECURITY_PATH);
  assert(stat.isFile, "expected SECURITY.md to be a regular file");
});

Deno.test("SECURITY.md documents a private disclosure contact", async () => {
  const text = (await Deno.readTextFile(SECURITY_PATH)).toLowerCase();
  // A reporting/disclosure section must exist...
  assert(
    text.includes("report") && text.includes("vulnerab"),
    "expected SECURITY.md to describe how to report a vulnerability",
  );
  // ...with a concrete private contact channel (email).
  assert(
    text.includes("security@stsoftware.com.au"),
    "expected SECURITY.md to list a private disclosure email",
  );
});

Deno.test("SECURITY.md documents an emergency dependency-bump procedure", async () => {
  const text = (await Deno.readTextFile(SECURITY_PATH)).toLowerCase();
  assert(
    text.includes("emergency") && text.includes("depend"),
    "expected SECURITY.md to describe an emergency dependency bump",
  );
  // The procedure should point at the real upgrade/quarantine machinery.
  assert(
    text.includes("deno outdated") &&
      text.includes("quarantine"),
    "expected SECURITY.md to reference the upgrade command and quarantine bypass",
  );
});

Deno.test("SECURITY.md documents the quarantine override (SCR-QUARANTINE-OVERRIDE)", async () => {
  const text = (await Deno.readTextFile(SECURITY_PATH)).toLowerCase();
  // The deliberate override lever is the repository variable read by the
  // upgrade workflow — name it explicitly so responders do not improvise.
  assert(
    text.includes("vibe_bump_quarantine_hours"),
    "expected SECURITY.md to name the VIBE_BUMP_QUARANTINE_HOURS override variable",
  );
  // The documented fast-lane is to set the window to 0 and trigger the
  // workflow manually via workflow_dispatch.
  assert(
    text.includes("workflow_dispatch"),
    "expected SECURITY.md to reference the workflow_dispatch manual trigger",
  );
  // The override must be reversible — the default has to be restored once the
  // emergency fix has merged.
  assert(
    text.includes("restore"),
    "expected SECURITY.md to require restoring the default quarantine window",
  );
});
