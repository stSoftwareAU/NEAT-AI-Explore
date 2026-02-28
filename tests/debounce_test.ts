import { debounce } from "../docs/shared/debounce.js";
import { assert, assertEquals } from "./test_helpers.ts";

/** Helper: wait for a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("debounce delays invocation until after the quiet period", async () => {
  let callCount = 0;
  const fn = debounce(() => {
    callCount++;
  }, 50);
  fn();
  assertEquals(callCount, 0, "should not fire immediately");
  await delay(80);
  assertEquals(callCount, 1, "should fire after the delay");
});

Deno.test("debounce resets the timer on rapid calls", async () => {
  let callCount = 0;
  const fn = debounce(() => {
    callCount++;
  }, 50);
  fn();
  await delay(20);
  fn(); // reset timer
  await delay(20);
  fn(); // reset timer again
  assertEquals(callCount, 0, "should not fire during rapid calls");
  await delay(80);
  assertEquals(callCount, 1, "should fire exactly once after final call");
});

Deno.test("debounce passes arguments to the wrapped function", async () => {
  let received: number[] = [];
  const fn = debounce((...args: number[]) => {
    received = args;
  }, 30);
  fn(1, 2, 3);
  await delay(60);
  assertEquals(received.length, 3);
  assertEquals(received[0], 1);
  assertEquals(received[1], 2);
  assertEquals(received[2], 3);
});

Deno.test("debounce cancel() prevents pending invocation", async () => {
  let callCount = 0;
  const fn = debounce(() => {
    callCount++;
  }, 50);
  fn();
  fn.cancel();
  await delay(80);
  assertEquals(callCount, 0, "should not fire after cancel");
});

Deno.test("debounce returns a function with cancel method", () => {
  const fn = debounce(() => {}, 100);
  assert(typeof fn === "function", "debounced should be callable");
  assert(typeof fn.cancel === "function", "should have cancel method");
});
