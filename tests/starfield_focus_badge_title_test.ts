function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_focus_badge_title_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_focus_badge_title_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("starfield clears focus badge title across all code paths (Issue #25)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);

  const start = js.indexOf("function setFocusBadge(uuid)");
  assert(start >= 0, "Expected setFocusBadge(uuid) to exist.");

  const end = js.indexOf("function clearLabelOverlay()", start);
  assert(
    end > start,
    "Expected setFocusBadge to appear before clearLabelOverlay.",
  );

  const fn = js.slice(start, end);

  // Regression: setFocusBadge previously left a stale `title` attribute behind when:
  // - The previous focus had no alias (badge.title was set on the outer element), then
  // - The next focus had an alias (badge.innerHTML updated, but badge.title was not updated), or
  // - uuid was falsy (badge.textContent cleared, but badge.title persisted).
  //
  // We enforce that the outer badge title is cleared/updated consistently so hover tooltips
  // never show a UUID/description from a previous focus.
  assert(
    fn.includes('el.focusBadge.title = ""') ||
      fn.includes("el.focusBadge.title = ''"),
    "Expected setFocusBadge to clear the focus badge title (empty string) as part of its update.",
  );
  assert(
    fn.includes("el.focusBadge.title = title"),
    "Expected setFocusBadge to set the outer focus badge title for alias and non-alias focus.",
  );
});
