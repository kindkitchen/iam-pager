import { test_page_aggregate_repository_conformance } from "./aggregate-repository-conformance.ts";
import { MemoryPageAggregateRepository } from "./memory-aggregate-repository.ts";

test_page_aggregate_repository_conformance({
  name: "MemoryPageAggregateRepository",
  make_subject: () => new MemoryPageAggregateRepository(),
});
