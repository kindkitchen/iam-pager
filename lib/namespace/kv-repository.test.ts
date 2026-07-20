import { assert, assertEquals, assertRejects } from "@std/assert";
import { KvToolboxGateway } from "../storage/kv-toolbox-gateway.ts";
import { test_namespace_repository_conformance } from "./conformance.ts";
import { DenoKvNamespaceRepository } from "./kv-repository.ts";

const conformance_handles = new WeakMap<object, Deno.Kv>();

function gateway(kv: Deno.Kv): KvToolboxGateway {
  return new KvToolboxGateway(kv);
}

test_namespace_repository_conformance({
  name: "DenoKvNamespaceRepository",
  make_repository: async () => {
    const kv = await Deno.openKv(":memory:");
    const repository = new DenoKvNamespaceRepository(gateway(kv));
    conformance_handles.set(repository, kv);
    return repository;
  },
  teardown: (repository) => {
    conformance_handles.get(repository)?.close();
    conformance_handles.delete(repository);
  },
});

Deno.test("DenoKvNamespaceRepository: state is shared outside repository instances", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const fixed = new Date("2026-07-18T00:00:00.000Z");
    const writer = new DenoKvNamespaceRepository(gateway(kv), {
      now: () => fixed,
    });
    const result = await writer.reserve({
      namespace: "Durable",
      owner_user_id: "user-a",
    });
    assert(result.ok);

    const reader = new DenoKvNamespaceRepository(gateway(kv));
    assertEquals(await reader.find("DURABLE"), {
      namespace: "Durable",
      owner_user_id: "user-a",
      reserved_at: fixed,
    });
    assertEquals(await reader.list_by_owner("user-a"), [{
      namespace: "Durable",
      owner_user_id: "user-a",
      reserved_at: fixed,
    }]);
    const storage_key = [
      "iam-pager",
      "namespace-reservations",
      "by-namespace",
      "durable",
    ];
    assertEquals((await kv.get(storage_key)).value, {
      schema_version: 1,
      namespace: "Durable",
      owner_user_id: "user-a",
      reserved_at: "2026-07-18T00:00:00.000Z",
    });

    await kv.set(storage_key, {
      schema_version: 1,
      namespace: "Other",
      owner_user_id: "user-a",
      reserved_at: "2026-07-18T00:00:00.000Z",
    });
    await assertRejects(
      () => reader.find("durable"),
      Error,
      "namespace repository invariant violated",
    );
  } finally {
    kv.close();
  }
});
