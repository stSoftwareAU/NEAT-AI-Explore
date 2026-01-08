function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/starfield_travel_effect_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield implements traveling effect when changing focus (Issue #50)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // There should be an animation/transition when moving between neurons.
  assert(
    js.includes("animateCameraTo") ||
      js.includes("travelToNeuron") ||
      js.includes("animateTransition"),
    `Expected ${jsPath} to include an animated camera transition function`,
  );

  // The animation should use requestAnimationFrame or similar for smooth motion.
  assert(
    js.includes("requestAnimationFrame"),
    `Expected ${jsPath} to use requestAnimationFrame for smooth animation`,
  );
});

Deno.test("starfield traveling effect follows synapse path (Issue #50)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The camera should travel along a path (not teleport).
  // Look for interpolation/easing logic.
  assert(
    js.includes("lerp") || js.includes("interpolate") || js.includes("easing"),
    `Expected ${jsPath} to include interpolation for smooth camera travel`,
  );

  // The travel should reference the synapse/connection being traversed.
  assert(
    js.includes("travelAlongSynapse") ||
      js.includes("animateAlongEdge") ||
      (js.includes("animate") && js.includes("synapse")),
    `Expected ${jsPath} to animate along synapse path`,
  );
});

Deno.test("starfield traveling effect has configurable duration (Issue #50)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // There should be a duration constant or parameter for the travel animation.
  assert(
    js.includes("TRAVEL_DURATION") ||
      js.includes("ANIMATION_DURATION") ||
      js.includes("travelDuration"),
    `Expected ${jsPath} to have a configurable travel animation duration`,
  );
});
