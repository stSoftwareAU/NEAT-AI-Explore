/**
 * Tests that the accessibility workflow only runs when its inputs change
 * (#652).
 *
 * `a11y.yml` serves `./docs` and scans it with `pa11y-ci` using
 * `pa11yci.json`. A diff that touches none of those (nor the workflow itself)
 * cannot change the result, so every trigger must carry a `paths:` filter
 * scoped to exactly those inputs. The workflow is not a required status check
 * (see `.github/rulesets/`), so a skipped run blocks nothing.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface Trigger {
  branches?: string[];
  paths?: string[];
  "paths-ignore"?: string[];
}

type Triggers = Record<string, Trigger | null | undefined>;

const WORKFLOW = new URL("../.github/workflows/a11y.yml", import.meta.url);
const REQUIRED_PATHS = [
  "docs/**",
  "pa11yci.json",
  ".github/workflows/a11y.yml",
];

async function loadTriggers(): Promise<Triggers> {
  const wf = parseYaml(await Deno.readTextFile(WORKFLOW)) as { on?: unknown };
  assert(
    wf.on !== undefined && typeof wf.on === "object" && wf.on !== null &&
      !Array.isArray(wf.on),
    "a11y.yml must declare an object-form `on:` block",
  );
  return wf.on as Triggers;
}

/** Minimal GitHub-style glob match: `**` spans `/`, `*` does not. */
function globMatch(glob: string, file: string): boolean {
  if (glob === "") return file === "";
  if (glob.startsWith("**")) {
    const rest = glob.slice(2);
    for (let i = 0; i <= file.length; i++) {
      if (globMatch(rest, file.slice(i))) return true;
    }
    return false;
  }
  if (glob[0] === "*") {
    const rest = glob.slice(1);
    for (let i = 0; i <= file.length; i++) {
      if (globMatch(rest, file.slice(i))) return true;
      if (file[i] === "/") break;
    }
    return false;
  }
  return file[0] === glob[0] && globMatch(glob.slice(1), file.slice(1));
}

function matchesAny(file: string, globs: string[]): boolean {
  return globs.some((glob) => globMatch(glob, file));
}

for (const event of ["pull_request", "push"]) {
  Deno.test(`a11y.yml ${event} trigger is scoped to its inputs (#652)`, async () => {
    const trigger = (await loadTriggers())[event];
    assert(trigger, `a11y.yml must keep its ${event} trigger`);
    const paths = trigger.paths ?? [];
    assert(
      !trigger["paths-ignore"],
      `a11y.yml ${event} must use an allowlist \`paths:\`, not paths-ignore`,
    );
    for (const required of REQUIRED_PATHS) {
      assert(
        paths.includes(required),
        `a11y.yml ${event}.paths must include '${required}'; got ` +
          JSON.stringify(paths),
      );
    }
  });

  Deno.test(`a11y.yml ${event} skips changes outside docs/ (#652)`, async () => {
    const paths = (await loadTriggers())[event]?.paths ?? [];
    for (
      const file of [
        "helpers/server.ts",
        "scripts/verify_csp.ts",
        "tests/pwa_test.ts",
        "README.md",
      ]
    ) {
      assert(
        !matchesAny(file, paths),
        `a11y.yml ${event} must not run for '${file}'; paths=${
          JSON.stringify(paths)
        }`,
      );
    }
    for (
      const file of ["docs/index.html", "docs/shared/app.js", "pa11yci.json"]
    ) {
      assert(
        matchesAny(file, paths),
        `a11y.yml ${event} must run for '${file}'; paths=${
          JSON.stringify(paths)
        }`,
      );
    }
  });
}
