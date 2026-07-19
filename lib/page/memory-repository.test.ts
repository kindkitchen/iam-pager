import { assert, assertEquals } from "@std/assert";
import { MemoryPageRepository } from "./memory-repository.ts";
import {
  make_page_content,
  test_page_repository_conformance,
} from "./repository-conformance.ts";

test_page_repository_conformance({
  name: "MemoryPageRepository",
  make_repository: () => new MemoryPageRepository(),
});

Deno.test(
  "MemoryPageRepository: returned records are isolated from internal state",
  async () => {
    const repository = new MemoryPageRepository();
    const content = make_page_content("v1");
    const result = await repository.put_trial({
      page_id: "iso-1",
      locator: { namespace: "ns" },
      content,
      now: new Date("2026-07-19T01:00:00.000Z"),
    });
    assert(result.ok);
    // Mutating the request content after the call must not affect storage.
    (content.data as { md: string }).md = "mutated-request";
    // Mutating returned records must not affect storage either.
    (result.page.content.data as { md: string }).md = "mutated-result";
    const first = await repository.find_by_id("iso-1");
    assert(first !== null);
    assertEquals((first.content.data as { md: string }).md, "v1");
    (first.content.data as { md: string }).md = "mutated-found";
    first.locator.namespace = "other";
    const second = await repository.find_by_id("iso-1");
    assertEquals((second?.content.data as { md: string }).md, "v1");
    assertEquals(second?.locator.namespace, "ns");
  },
);
