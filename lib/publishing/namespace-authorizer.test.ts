import { assertEquals } from "@std/assert";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import { NamespacePublishingAuthorizer } from "./namespace-authorizer.ts";

async function make_authorizer() {
  const repository = new MemoryNamespaceRepository();
  const reserved = await repository.reserve({
    namespace: "Claimed",
    owner_user_id: "owner-1",
  });
  if (!reserved.ok) throw new Error("test setup: reserve failed");
  return new NamespacePublishingAuthorizer(repository);
}

Deno.test("unreserved namespace allows guest, owner-to-be, and any user", async () => {
  const authorizer = await make_authorizer();
  const actors = [
    { kind: "guest" } as const,
    { kind: "user", user_id: "owner-1" } as const,
    { kind: "user", user_id: "someone-else" } as const,
  ];
  for (const actor of actors) {
    assertEquals(await authorizer.authorize(actor, "free"), { allowed: true });
  }
});

Deno.test("reserved namespace rejects a guest write", async () => {
  const authorizer = await make_authorizer();
  assertEquals(await authorizer.authorize({ kind: "guest" }, "Claimed"), {
    allowed: false,
    reason: "namespace_reserved",
  });
});

Deno.test("reserved namespace allows its owner", async () => {
  const authorizer = await make_authorizer();
  assertEquals(
    await authorizer.authorize(
      { kind: "user", user_id: "owner-1" },
      "Claimed",
    ),
    { allowed: true },
  );
});

Deno.test("reserved namespace rejects another authenticated user", async () => {
  const authorizer = await make_authorizer();
  assertEquals(
    await authorizer.authorize(
      { kind: "user", user_id: "intruder" },
      "Claimed",
    ),
    { allowed: false, reason: "namespace_reserved" },
  );
});

Deno.test("reservation protects every casing of the namespace", async () => {
  const authorizer = await make_authorizer();
  for (const namespace of ["claimed", "CLAIMED", "cLaImEd"]) {
    assertEquals(await authorizer.authorize({ kind: "guest" }, namespace), {
      allowed: false,
      reason: "namespace_reserved",
    });
    assertEquals(
      await authorizer.authorize(
        { kind: "user", user_id: "owner-1" },
        namespace,
      ),
      { allowed: true },
    );
  }
});
