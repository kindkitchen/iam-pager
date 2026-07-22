import { assertRejects } from "@std/assert";
import { test_storage_connection_repository_conformance } from "./connection-repository-conformance.ts";
import { MemoryStorageConnectionRepository } from "./memory-connection-repository.ts";

test_storage_connection_repository_conformance({
  name: "MemoryStorageConnectionRepository",
  make_repository: () => new MemoryStorageConnectionRepository(),
});

Deno.test("MemoryStorageConnectionRepository: faults are injected once", async () => {
  const repository = new MemoryStorageConnectionRepository();
  repository.fail_next(new Error("storage unavailable"));
  await assertRejects(
    async () => await repository.find_by_id("connection-1"),
    Error,
    "storage unavailable",
  );
  await repository.find_by_id("connection-1");
});
