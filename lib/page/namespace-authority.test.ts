import { assertEquals } from "@std/assert";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import { RepositoryNamespaceAuthorityResolver } from "./namespace-authority.ts";

Deno.test("namespace authority resolves unreserved, owned, and other without owner data", async () => {
  const repository = new MemoryNamespaceRepository();
  await repository.reserve({ namespace: "Claimed", owner_user_id: "owner-1" });
  const resolver = new RepositoryNamespaceAuthorityResolver(repository);

  assertEquals(await resolver.resolve({ kind: "guest" }, "free"), {
    kind: "unreserved",
  });
  assertEquals(
    await resolver.resolve(
      { kind: "user", user_id: "owner-1" },
      "CLAIMED",
    ),
    { kind: "owned" },
  );
  assertEquals(
    await resolver.resolve(
      { kind: "user", user_id: "other" },
      "claimed",
    ),
    { kind: "reserved_by_other" },
  );
  assertEquals(await resolver.resolve({ kind: "guest" }, "Claimed"), {
    kind: "reserved_by_other",
  });
});
