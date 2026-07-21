# Changelog

## 2026-07-21

- Added a designed 404 page with a prominent route to public exploration and a
  secondary home link, including the same recovery actions in missing wrapped
  page views.
- Aligned the web with one-content/many-locator pages: Markdown and PDF
  publishing now use explicit primary/optional-alias reference sets, PDF paths
  use independent downloadable controls, creators select from owned namespaces,
  management can edit complete reference sets while content-only PDF replacement
  preserves them, and public/management PDF views support any inline/attachment
  combination. Public exploration moved to the navigable `/site/explore` page
  with legacy-query redirects.
- Added the `web-multi-reference-ux` implementation task to align publishing and
  management with one-content/many-locator references, make PDF aliases optional
  with explicit downloadable controls, use owned-namespace selectors for
  creators, and move exploration to its own navigable page.
- Decoupled logical content from its locator references: every publication now
  uses one non-empty, format-neutral endpoint set; references may span
  namespaces owned by the same creator; delivery profiles are extensible
  handler-validated attributes; JSON and PDF updates can preserve or explicitly
  replace locators; and PDF no longer requires a preview/download pair. The
  domain has no endpoint-count limit, while Deno KV reports its current
  eight-reference atomic capacity explicitly. Existing site projection conflicts
  are documented for a separate UI task.
- Concentrated the repository on the current product while preserving its
  behavior and interface boundaries. More than 21,000 lines were removed across
  release-transition storage code, disconnected page adapters, migration and
  database-release machinery, repeated composition coverage, compatibility-only
  branches, redundant helpers, generated dependency state, specifications, and
  closed task histories. `PageAggregateRepository` is the sole page persistence
  contract; memory and strict Deno KV implementations retain shared conformance,
  atomic visibility, and verified content staging. The specification and API now
  describe current requirements, and all closed work is represented by one
  two-file project baseline rather than intermediate or rejected states. The
  focused 441-test suite, repository checks, and production build pass.
