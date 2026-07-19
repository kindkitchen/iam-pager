import { assert, assertEquals } from "@std/assert";
import { CryptoPageIdGenerator } from "./generators.ts";
import { is_valid_page_id } from "./model.ts";

Deno.test("CryptoPageIdGenerator produces unique route-safe 22-char ids", () => {
  const generator = new CryptoPageIdGenerator();
  const seen = new Set<string>();
  for (let index = 0; index < 500; index += 1) {
    const id = generator.generate();
    assert(/^[A-Za-z0-9_-]{22}$/.test(id), `unexpected id shape: ${id}`);
    assert(is_valid_page_id(id));
    seen.add(id);
  }
  assertEquals(seen.size, 500);
});
