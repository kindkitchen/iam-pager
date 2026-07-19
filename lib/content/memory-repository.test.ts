import { MemoryContentRepository } from "./memory-repository.ts";
import { test_content_repository_conformance } from "./repository-conformance.ts";

test_content_repository_conformance({
  name: "MemoryContentRepository",
  make_repository: () => new MemoryContentRepository(),
});
