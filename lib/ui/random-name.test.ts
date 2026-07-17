import { assertEquals, assertThrows } from "@std/assert";
import {
  CryptoRandomIndexSource,
  FourWordRandomNameGenerator,
  type RandomIndexSource,
} from "./random-name.ts";

class FixedRandomIndexSource implements RandomIndexSource {
  #indexes: number[];

  constructor(indexes: number[]) {
    this.#indexes = indexes;
  }

  pick(max_exclusive: number): number {
    const index = this.#indexes.shift() ?? 0;
    if (index >= max_exclusive) throw new Error("fixture index out of range");
    return index;
  }
}

Deno.test("random names use four grammatical word dimensions", () => {
  const generator = new FourWordRandomNameGenerator(
    new FixedRandomIndexSource([5, 5, 2, 2]),
  );
  assertEquals(generator.generate(), "tiny-red-glad-fox");
});

Deno.test("random names add a numeric fallback for known combinations", () => {
  const generator = new FourWordRandomNameGenerator(
    new FixedRandomIndexSource([5, 5, 2, 2]),
  );
  assertEquals(
    generator.generate(
      new Set(["tiny-red-glad-fox", "tiny-red-glad-fox-2"]),
    ),
    "tiny-red-glad-fox-3",
  );
});

Deno.test("crypto source rejects invalid ranges", () => {
  const random = new CryptoRandomIndexSource();
  assertThrows(() => random.pick(0), Error, "positive safe integer");
  assertThrows(() => random.pick(1.5), Error, "positive safe integer");
});
