import { assert, assertEquals } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MemoryNamespaceRepository } from "./memory-repository.ts";
import { NamespaceReservationService } from "./service.ts";

function make_service(forbidden_namespaces: readonly string[] = ["site"]) {
  const repository = new MemoryNamespaceRepository();
  const service = new NamespaceReservationService({
    engine: new LocatorEngine({
      strategies: [new PathSlugStrategy()],
      forbidden_namespaces,
    }),
    repository,
  });
  return { service, repository };
}

Deno.test("reserve claims a valid namespace and preserves casing", async () => {
  const { service, repository } = make_service();
  const result = await service.reserve({
    namespace: "Ada Lovelace",
    owner_user_id: "user-a",
  });
  assert(result.ok);
  assertEquals(result.reservation.namespace, "Ada Lovelace");
  assertEquals(result.reservation.owner_user_id, "user-a");
  const stored = await repository.find("ada lovelace");
  assertEquals(stored?.namespace, "Ada Lovelace");
});

Deno.test("reserve rejects a forbidden namespace with a typed reason", async () => {
  const { service, repository } = make_service();
  for (const namespace of ["site", "SITE", "Site"]) {
    const result = await service.reserve({
      namespace,
      owner_user_id: "user-a",
    });
    assertEquals(result, { ok: false, reason: "forbidden_namespace" });
  }
  assertEquals(await repository.find("site"), null);
});

Deno.test("reserve rejects a malformed namespace with a typed reason", async () => {
  const { service, repository } = make_service();
  for (const namespace of ["", ".", "..", "a/b"]) {
    const result = await service.reserve({
      namespace,
      owner_user_id: "user-a",
    });
    assertEquals(result, { ok: false, reason: "invalid_namespace" });
  }
  assertEquals(await repository.list_by_owner("user-a"), []);
});

Deno.test("reserve delegates validity to the engine, not its own rules", async () => {
  const { service } = make_service(["members-only"]);
  const rejected = await service.reserve({
    namespace: "Members-Only",
    owner_user_id: "user-a",
  });
  assertEquals(rejected, { ok: false, reason: "forbidden_namespace" });
  const allowed = await service.reserve({
    namespace: "site",
    owner_user_id: "user-a",
  });
  assert(allowed.ok);
});

Deno.test("reserve reports taken across casings and keeps the winner", async () => {
  const { service, repository } = make_service();
  const first = await service.reserve({
    namespace: "MyNs",
    owner_user_id: "user-a",
  });
  assert(first.ok);
  const second = await service.reserve({
    namespace: "MYNS",
    owner_user_id: "user-b",
  });
  assertEquals(second, { ok: false, reason: "taken" });
  assertEquals((await repository.find("myns"))?.owner_user_id, "user-a");
});

Deno.test("list_owned returns exactly the user's reservations", async () => {
  const { service } = make_service();
  await service.reserve({ namespace: "One", owner_user_id: "user-a" });
  await service.reserve({ namespace: "Two", owner_user_id: "user-b" });
  await service.reserve({ namespace: "Three", owner_user_id: "user-a" });
  const owned = await service.list_owned("user-a");
  assertEquals(
    owned.map((reservation) => reservation.namespace).sort(),
    ["One", "Three"],
  );
  assertEquals(await service.list_owned("user-c"), []);
});
