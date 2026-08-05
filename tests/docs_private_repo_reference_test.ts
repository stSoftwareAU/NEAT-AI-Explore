/**
 * Guards the public docs tree against private-repo name leakage (#596).
 *
 * Everything under `docs/` is published to the public GitHub Pages site, so
 * naming a private `stSoftwareAU` repository points public readers at
 * something they cannot see. Private repositories must be described by role
 * ("a private internal workflow-automation repository"), never by name.
 *
 * The forbidden names are assembled from fragments at runtime so this test
 * file does not itself become a textual mention of a private repo.
 */

import { assert } from "./test_helpers.ts";

const DOCS_DIR = new URL("../docs/", import.meta.url);

/** Private `stSoftwareAU` repo names that must never appear under `docs/`. */
const FORBIDDEN_NAMES: string[] = ["Vibe" + "Coding"];

/** Recursively collects every text-bearing file under `dir`. */
async function collectTextFiles(dir: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) {
      files.push(...await collectTextFiles(child));
    } else if (/\.(md|html|txt|json|js|css)$/.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

Deno.test("docs/ names no private stSoftwareAU repository", async () => {
  const files = await collectTextFiles(DOCS_DIR);
  assert(files.length > 0, "expected docs/ to contain text files");

  const offenders: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await Deno.readTextFile(file);
    } catch {
      continue; // Unreadable (e.g. binary masquerading as text) — skip.
    }
    for (const name of FORBIDDEN_NAMES) {
      if (text.includes(name)) {
        offenders.push(`${file.pathname} mentions a private repo by name`);
      }
    }
  }

  assert(
    offenders.length === 0,
    `private repository named in published docs:\n${offenders.join("\n")}`,
  );
});
