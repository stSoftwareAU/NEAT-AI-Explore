import { assertEquals } from "./test_helpers.ts";
import { createDebounce } from "../docs/shared/debounce.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("createDebounce – only fires after the delay elapses", async () => {
  let count = 0;
  const { call } = createDebounce(() => count++, 50);

  call();
  assertEquals(count, 0, "should not fire immediately");

  await delay(80);
  assertEquals(count, 1, "should fire once after delay");
});

Deno.test("createDebounce – resets timer on rapid calls", async () => {
  let count = 0;
  const { call } = createDebounce(() => count++, 50);

  call();
  await delay(20);
  call(); // reset
  await delay(20);
  call(); // reset again
  assertEquals(count, 0, "should not have fired during rapid calls");

  await delay(80);
  assertEquals(count, 1, "should fire exactly once after final call");
});

Deno.test("createDebounce – passes arguments to the wrapped function", async () => {
  let received: unknown[] = [];
  const { call } = createDebounce((...args: unknown[]) => {
    received = args;
  }, 30);

  call("a", 42);
  await delay(60);
  assertEquals(received.length, 2);
  assertEquals(received[0], "a");
  assertEquals(received[1], 42);
});

Deno.test("createDebounce – cancel prevents pending invocation", async () => {
  let count = 0;
  const { call, cancel } = createDebounce(() => count++, 50);

  call();
  cancel();
  await delay(80);
  assertEquals(count, 0, "should not fire after cancel");
});

Deno.test("createDebounce – can be called again after cancel", async () => {
  let count = 0;
  const { call, cancel } = createDebounce(() => count++, 30);

  call();
  cancel();
  call();
  await delay(60);
  assertEquals(count, 1, "should fire once after re-calling post-cancel");
});
