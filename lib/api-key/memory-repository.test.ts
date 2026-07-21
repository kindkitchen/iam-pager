import { MemoryApiKeyRepository } from "./memory-repository.ts";
import { test_api_key_repository_conformance } from "./repository-conformance.ts";

test_api_key_repository_conformance({
  name: "MemoryApiKeyRepository",
  make_repository: () => new MemoryApiKeyRepository(),
});
