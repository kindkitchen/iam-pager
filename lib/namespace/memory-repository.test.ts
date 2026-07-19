import { assert, assertEquals } from "@std/assert";
import { test_namespace_repository_conformance } from "./conformance.ts";
import { MemoryNamespaceRepository } from "./memory-repository.ts";

test_namespace_repository_conformance({
  name: "MemoryNamespaceRepository",
  make_repository: () => new MemoryNamespaceRepository(),
});

Deno.test("MemoryNamespaceRepository: reserved_at comes from the injected clock", async () => {
  const fixed = new Date("2026-07-18T00:00:00Z");
  const repository = new MemoryNamespaceRepository({ now: () => fixed });
  const result = await repository.reserve({
    namespace: "ns",
    owner_user_id: "user-a",
  });
  assert(result.ok);
  assertEquals(result.reservation.reserved_at, fixed);
});
