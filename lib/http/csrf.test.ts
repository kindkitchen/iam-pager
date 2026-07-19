import { assertEquals } from "@std/assert";
import { csrf_tokens_match } from "./csrf.ts";

Deno.test("csrf_tokens_match accepts only the exact synchronizer token", () => {
  const expected = "c".repeat(43);
  assertEquals(csrf_tokens_match(expected, expected), true);
  assertEquals(csrf_tokens_match(expected, `${"c".repeat(42)}d`), false);
  assertEquals(csrf_tokens_match(expected, "c".repeat(42)), false);
  assertEquals(csrf_tokens_match(expected, `${expected}c`), false);
  assertEquals(csrf_tokens_match(expected, ""), false);
});
