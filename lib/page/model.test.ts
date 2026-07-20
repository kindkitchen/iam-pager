import { assertEquals } from "@std/assert";
import {
  is_valid_page_tags,
  max_page_tag_length,
  max_page_tags,
  normalize_page_tag,
  normalize_page_tags,
} from "./model.ts";

Deno.test("page tags normalize to a bounded canonical sorted unique set", () => {
  assertEquals(normalize_page_tag(" DENO_2 "), "deno_2");
  assertEquals(
    normalize_page_tags([" News ", "deno", "news", "release-note"]),
    ["deno", "news", "release-note"],
  );
  assertEquals(normalize_page_tags([]), []);
});

Deno.test("page tags reject unsafe values and non-canonical storage forms", () => {
  for (const invalid of ["", "two words", "bad!", "-prefix", "suffix-"]) {
    assertEquals(normalize_page_tag(invalid), null);
  }
  assertEquals(normalize_page_tag("x".repeat(max_page_tag_length + 1)), null);
  assertEquals(
    normalize_page_tags(
      Array.from({ length: max_page_tags + 1 }, (_, index) => `tag-${index}`),
    ),
    null,
  );
  assertEquals(is_valid_page_tags(["deno", "news"]), true);
  assertEquals(is_valid_page_tags(["news", "deno"]), false);
  assertEquals(is_valid_page_tags(["deno", "deno"]), false);
  assertEquals(is_valid_page_tags(["Deno"]), false);
});
