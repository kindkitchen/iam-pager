import { test_identity_repository_conformance } from "./identity-repository-conformance.ts";
import { MemoryIdentityRepository } from "./memory-identity-repository.ts";

test_identity_repository_conformance({
  name: "MemoryIdentityRepository",
  make_repository: (id_generator) => new MemoryIdentityRepository(id_generator),
});
