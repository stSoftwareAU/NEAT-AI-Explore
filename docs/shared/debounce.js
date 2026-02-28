/**
 * Creates a debounced version of a function that delays invocation until
 * after `delayMs` milliseconds have elapsed since the last call.
 *
 * @param {Function} fn - The function to debounce.
 * @param {number} delayMs - Delay in milliseconds.
 * @returns {{ call: Function, cancel: Function }} Object with `call` (the
 *   debounced wrapper) and `cancel` (clears any pending invocation).
 */
export function createDebounce(fn, delayMs) {
  let timerId = null;
  function call(...args) {
    if (timerId != null) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn(...args);
    }, delayMs);
  }
  function cancel() {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }
  return { call, cancel };
}
