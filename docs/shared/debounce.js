/**
 * Creates a debounced version of a function that delays invocation until
 * after `delayMs` milliseconds have elapsed since the last call.
 *
 * @param {Function} fn - The function to debounce.
 * @param {number} delayMs - Delay in milliseconds.
 * @returns {Function & { cancel: () => void }} Debounced function with a
 *   `cancel()` method to clear any pending invocation.
 */
export function debounce(fn, delayMs) {
  let timerId = 0;

  /** @type {Function & { cancel: () => void }} */
  const debounced = function (...args) {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn.apply(this, args), delayMs);
  };

  debounced.cancel = () => clearTimeout(timerId);
  return debounced;
}
