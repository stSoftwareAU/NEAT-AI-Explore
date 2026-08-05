/**
 * Shared status/progress widget controller tests (Issue #597).
 *
 * The Trace, DAG, Graph and Subgraph views each carried a private copy of the
 * `setStatus` / `showProgress` / `updateProgress` / `hideProgress` quadruplet
 * and the copies had diverged (indeterminate loads pulsed in two views and
 * showed a static 35% bar in the other two; only three copies null-guarded
 * `setStatus`). `createProgressUi` is now the single source of truth, so these
 * tests pin the behaviour every view inherits.
 *
 * The helper only touches `textContent`, `className`, `style.display`,
 * `style.width` and `classList`, so a small stub element exercises it
 * faithfully — deno-dom elements have no `style` property.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { createProgressUi } from "../docs/shared/progress_ui.js";

/** Minimal element stub: `classList` reads and writes `className`. */
class StubElement {
  textContent = "";
  className = "";
  style: Record<string, string> = { display: "", width: "" };

  classList = {
    add: (name: string) => {
      const names = this.#names();
      if (!names.includes(name)) names.push(name);
      this.className = names.join(" ");
    },
    remove: (name: string) => {
      this.className = this.#names().filter((n) => n !== name).join(" ");
    },
    contains: (name: string) => this.#names().includes(name),
  };

  #names(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }
}

function makeUi() {
  const status = new StubElement();
  const progressContainer = new StubElement();
  const progressBar = new StubElement();
  const ui = createProgressUi({ status, progressContainer, progressBar });
  return { ui, status, progressContainer, progressBar };
}

Deno.test("setStatus writes the message and the statusInline class", () => {
  const { ui, status } = makeUi();

  ui.setStatus("Loading snapshot…");
  assertEquals(status.textContent, "Loading snapshot…");
  assertEquals(status.className, "statusInline");

  ui.setStatus("Load failed", "bad");
  assertEquals(status.textContent, "Load failed");
  assertEquals(status.className, "statusInline bad");
});

Deno.test("setStatus coerces nullish messages to an empty string", () => {
  const { ui, status } = makeUi();
  status.textContent = "stale";

  ui.setStatus(null);

  assertEquals(status.textContent, "");
});

Deno.test("setStatus is a no-op when the status element is absent", () => {
  const ui = createProgressUi({
    status: null,
    progressContainer: new StubElement(),
    progressBar: new StubElement(),
  });

  ui.setStatus("no status element here", "bad");
});

Deno.test("showProgress(true) shows an indeterminate (pulsing) bar", () => {
  const { ui, progressContainer, progressBar } = makeUi();

  ui.showProgress(true);

  assertEquals(progressContainer.style.display, "");
  assert(
    progressBar.classList.contains("indeterminate"),
    "an unknown-size load must pulse rather than fake a fixed width",
  );
  assertEquals(
    progressBar.style.width,
    "",
    "the indeterminate width comes from CSS, not an inline style",
  );
});

Deno.test("showProgress(false) shows an empty determinate bar", () => {
  const { ui, progressContainer, progressBar } = makeUi();
  ui.showProgress(true);

  ui.showProgress(false);

  assertEquals(progressContainer.style.display, "");
  assertEquals(progressBar.classList.contains("indeterminate"), false);
  assertEquals(progressBar.style.width, "0%");
});

Deno.test("showProgress defaults to determinate", () => {
  const { ui, progressBar } = makeUi();

  ui.showProgress();

  assertEquals(progressBar.classList.contains("indeterminate"), false);
  assertEquals(progressBar.style.width, "0%");
});

Deno.test("showProgress preserves other classes on the bar", () => {
  const { ui, progressBar } = makeUi();
  progressBar.className = "progressBar";

  ui.showProgress(true);
  assertEquals(progressBar.className, "progressBar indeterminate");

  ui.showProgress(false);
  assertEquals(progressBar.className, "progressBar");
});

Deno.test("updateProgress clamps the percentage to 0–100", () => {
  const { ui, progressBar } = makeUi();

  ui.updateProgress(42.5);
  assertEquals(progressBar.style.width, "42.5%");

  ui.updateProgress(-10);
  assertEquals(progressBar.style.width, "0%");

  ui.updateProgress(150);
  assertEquals(progressBar.style.width, "100%");
});

Deno.test("updateProgress cancels the indeterminate pulse", () => {
  const { ui, progressBar } = makeUi();
  ui.showProgress(true);

  ui.updateProgress(25);

  assertEquals(progressBar.classList.contains("indeterminate"), false);
  assertEquals(progressBar.style.width, "25%");
});

Deno.test("updateProgress rejects a non-finite percentage loudly", () => {
  const { ui, progressBar } = makeUi();

  for (const bad of [NaN, Infinity, "eighty"]) {
    let thrown: unknown = null;
    try {
      ui.updateProgress(bad as number);
    } catch (e) {
      thrown = e;
    }
    assert(
      thrown instanceof TypeError,
      `updateProgress(${String(bad)}) must throw rather than render "NaN%"`,
    );
  }
  assertEquals(progressBar.style.width, "");
});

Deno.test("hideProgress hides the container", () => {
  const { ui, progressContainer } = makeUi();
  ui.showProgress(true);

  ui.hideProgress();

  assertEquals(progressContainer.style.display, "none");
});

Deno.test("progress calls are no-ops when the widget elements are absent", () => {
  const ui = createProgressUi({ status: new StubElement() });

  ui.showProgress(true);
  ui.updateProgress(50);
  ui.hideProgress();
});

Deno.test("createProgressUi requires an options object", () => {
  let thrown: unknown = null;
  try {
    // @ts-expect-error — deliberate misuse: the factory must fail loudly.
    createProgressUi();
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof TypeError, "missing options must throw a TypeError");
});
