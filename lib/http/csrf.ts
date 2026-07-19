/**
 * Compare synchronizer tokens without content-dependent early exit. A length
 * mismatch is rejected before the fixed-length comparison.
 */
export function csrf_tokens_match(expected: string, actual: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}
