import { test_session_repository_conformance } from "./repository-conformance.ts";
import { MemorySessionRepository } from "./memory-repository.ts";

test_session_repository_conformance({
  name: "MemorySessionRepository",
  make_repository: () => new MemorySessionRepository(),
});
