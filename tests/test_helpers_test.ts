import { approx, assert, assertEquals } from "./test_helpers.ts";

// --- assert ---

Deno.test("assert passes for truthy values", () => {
  assert(true);
  assert(1);
  assert("non-empty");
  assert({});
  assert([]);
});

Deno.test("assert throws for falsy values", () => {
  let threw = false;
  try {
    assert(false, "should throw");
  } catch (e) {
    threw = true;
    assert((e as Error).message === "should throw");
  }
  if (!threw) throw new Error("Expected assert(false) to throw");
});

Deno.test("assert throws with default message when none provided", () => {
  let threw = false;
  try {
    assert(false);
  } catch (e) {
    threw = true;
    assert((e as Error).message === "Assertion failed");
  }
  if (!threw) throw new Error("Expected assert(false) to throw");
});

// --- assertEquals ---

Deno.test("assertEquals passes for strictly equal values", () => {
  assertEquals(42, 42);
  assertEquals("hello", "hello");
  assertEquals(true, true);
  assertEquals(null, null);
  assertEquals(undefined, undefined);
});

Deno.test("assertEquals throws for non-equal values", () => {
  let threw = false;
  try {
    assertEquals(1, 2, "mismatch");
  } catch (e) {
    threw = true;
    assert((e as Error).message === "mismatch");
  }
  if (!threw) throw new Error("Expected assertEquals(1, 2) to throw");
});

Deno.test("assertEquals throws with descriptive default message", () => {
  let threw = false;
  try {
    assertEquals("a", "b");
  } catch (e) {
    threw = true;
    const msg = (e as Error).message;
    assert(
      msg.includes('"a"') && msg.includes('"b"'),
      `Expected message to include both values, got: ${msg}`,
    );
  }
  if (!threw) throw new Error("Expected assertEquals to throw");
});

// --- approx ---

Deno.test("approx passes for equal values", () => {
  approx(1.0, 1.0);
});

Deno.test("approx passes within default tolerance (1e-9)", () => {
  approx(1.0, 1.0 + 1e-10);
});

Deno.test("approx fails outside default tolerance (1e-9)", () => {
  let threw = false;
  try {
    approx(1.0, 1.0 + 1e-8);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      "Expected approx to throw for values outside 1e-9 tolerance",
    );
  }
});

Deno.test("approx respects custom tolerance", () => {
  // Should pass with tolerance of 0.1
  approx(1.0, 1.05, 0.1);

  // Should fail with tolerance of 0.01
  let threw = false;
  try {
    approx(1.0, 1.05, 0.01);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      "Expected approx to throw for values outside custom tolerance",
    );
  }
});

Deno.test("approx includes expected and actual in error message", () => {
  let threw = false;
  try {
    approx(5.0, 10.0);
  } catch (e) {
    threw = true;
    const msg = (e as Error).message;
    assert(
      msg.includes("10"),
      `Expected message to include expected value, got: ${msg}`,
    );
    assert(
      msg.includes("5"),
      `Expected message to include actual value, got: ${msg}`,
    );
  }
  if (!threw) throw new Error("Expected approx to throw");
});

Deno.test("approx uses custom message when provided", () => {
  let threw = false;
  try {
    approx(0, 100, 1e-9, "custom error");
  } catch (e) {
    threw = true;
    assert((e as Error).message === "custom error");
  }
  if (!threw) throw new Error("Expected approx to throw");
});
