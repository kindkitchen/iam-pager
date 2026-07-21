# Changelog

## 2026-07-21

- Replaced 28 closed delivery-task histories with one current project baseline,
  removing intermediate and rejected states while retaining completed behavior,
  architectural boundaries, open scope, and verification context. `tasks/` fell
  from 245 files and 7,208 lines to 2 files and 158 lines. Renamed the obsolete
  `IAM_PAGER_CONTENT_STORAGE_BACKEND` selector to the current
  `IAM_PAGER_PAGE_STORAGE_BACKEND` boundary; no compatibility alias remains.
  Test-only repository conformance suites no longer leak through production
  module exports.
- Concentrated the project on its current product: `PageAggregateRepository` is
  now the only page persistence boundary for memory and Deno KV; removed the
  schema-v1 page adapter, compatibility service path, migration/readiness and
  database-release machinery, obsolete adapter branches, and tests that existed
  only for those transitions. Rewrote README, specification, API, and deployment
  guidance as current requirements instead of implementation history. The
  worktree is about 10,900 lines smaller; all 454 current tests, checks, and the
  production build pass.
