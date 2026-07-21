# Changelog

## 2026-07-21

- Concentrated the project on its current product: `PageAggregateRepository` is
  now the only page persistence boundary for memory and Deno KV; removed the
  schema-v1 page adapter, compatibility service path, migration/readiness and
  database-release machinery, obsolete adapter branches, and tests that existed
  only for those transitions. Rewrote README, specification, API, and deployment
  guidance as current requirements instead of implementation history. The
  worktree is about 10,900 lines smaller; all 454 current tests, checks, and the
  production build pass.
