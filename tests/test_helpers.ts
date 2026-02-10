/**
 * Shared test assertion helpers.
 *
 * Centralises the assertion utilities that were previously duplicated across
 * every test file with inconsistent names and default tolerances.
 */

/** Asserts that a condition is truthy. */
export function assert(
  condition: unknown,
  message?: string,
): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

/** Asserts strict equality (===) between two values. */
export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Assertion failed: expected ${JSON.stringify(expected)} but got ${
          JSON.stringify(actual)
        }`,
    );
  }
}

/** Asserts that two numbers are within a tolerance of each other. */
export function approx(
  actual: number,
  expected: number,
  tol = 1e-9,
  message?: string,
): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(
      message ??
        `Expected ~${expected} but got ${actual} (tol=${tol})`,
    );
  }
}
