/**
 * Test for Issue #79: Odd alignment of buttons.
 *
 * The trace bar buttons (← Back, Clear, Observations, 🧠) should all be
 * vertically aligned. The issue was that the graphBtn (an anchor element
 * with an emoji) was not properly vertically centred compared to the
 * regular button elements.
 *
 * The fix ensures that `.button` uses inline-flex with align-items: center
 * to properly centre content (especially emojis) within buttons.
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/button_alignment_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("button class uses inline-flex for proper vertical alignment (Issue #79)", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // Extract the .button rule block (not .button.themeToggle or other variants)
  // The .button class should use inline-flex display to enable vertical
  // centering of content (important for emoji buttons like graphBtn).
  //
  // Match ".button {" followed by its content until the closing "}"
  const buttonRuleMatch = css.match(/\.button\s*\{([^}]+)\}/);
  assert(buttonRuleMatch, `Expected ${p} to have a .button rule block`);

  const buttonRuleContent = buttonRuleMatch[1];
  assert(
    buttonRuleContent.includes("display: inline-flex"),
    `Expected .button rule in ${p} to have display: inline-flex (Issue #79)`,
  );
});

Deno.test("button class uses align-items: center for vertical centering (Issue #79)", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // Extract the .button rule block (not .button.themeToggle or other variants)
  // The .button class should use align-items: center to vertically centre
  // content within the button (fixes emoji alignment issue).
  const buttonRuleMatch = css.match(/\.button\s*\{([^}]+)\}/);
  assert(buttonRuleMatch, `Expected ${p} to have a .button rule block`);

  const buttonRuleContent = buttonRuleMatch[1];
  assert(
    buttonRuleContent.includes("align-items: center"),
    `Expected .button rule in ${p} to have align-items: center (Issue #79)`,
  );
});

Deno.test("button class uses justify-content: center for horizontal centering (Issue #79)", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // Extract the .button rule block (not .button.themeToggle or other variants)
  // The .button class should use justify-content: center to horizontally
  // centre content within the button.
  const buttonRuleMatch = css.match(/\.button\s*\{([^}]+)\}/);
  assert(buttonRuleMatch, `Expected ${p} to have a .button rule block`);

  const buttonRuleContent = buttonRuleMatch[1];
  assert(
    buttonRuleContent.includes("justify-content: center"),
    `Expected .button rule in ${p} to have justify-content: center (Issue #79)`,
  );
});

Deno.test("trace bar buttons are all in the traceButtons container (Issue #79)", async () => {
  const p = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(p);

  // All trace bar buttons should be inside the traceButtons container
  // for consistent alignment.
  assert(
    html.includes('class="traceButtons"'),
    `Expected ${p} to have a traceButtons container`,
  );

  // The container should hold Back, Clear, Observations and Graph buttons
  assert(
    html.includes('id="traceBackBtn"'),
    `Expected ${p} to have traceBackBtn`,
  );
  assert(
    html.includes('id="traceClearBtn"'),
    `Expected ${p} to have traceClearBtn`,
  );
  assert(
    html.includes('id="obsBtn"'),
    `Expected ${p} to have obsBtn`,
  );
  assert(
    html.includes('id="graphBtn"'),
    `Expected ${p} to have graphBtn`,
  );
});
