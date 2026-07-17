# Changelog

## 2026-07-18

- Implemented the routing-agnostic locator layer under `lib/locator/` (locator
  model with case-insensitive identity key, strategy interface, engine with
  forbidden-namespace policy, first `path-slug` strategy) and the
  interface-first content contracts under `lib/content/` (`ContentTypeHandler`,
  `ContentRepository`, delivery metadata), with 23 tests and a `deno task test`
  task.
- Activated task `content-publishing` with a design analysis and a code review
  entry.

## 2026-07-17

- Specified that guest pages are excluded from site search and browsing and are
  reachable only by direct URL for raw preview (updated `EX-EXPLORE`,
  `EX-PUBLISH`, `CP-EXPLORE`, `DS-EXPLORE`, `QT-SEARCH`, `QT-VERIFY`,
  `DA-ACCESS`).
- Created task `content-publishing` covering the strategy-based locator engine,
  `/site` SPA alias, interface-first content CRUD, the `MdPage` content type,
  and the guest publish-and-open flow.

## 2026-07-15

- Added stable semantic section markers, defined case-insensitive locator
  identity with original spelling preserved, settled URL shape as an agnostic
  integration choice, and refreshed the remaining MVP questions.
- Rebalanced the specification around URL-based content publishing, direct
  delivery, exploration, and management; guest publishing is now presented only
  as a limited extension of the normal publishing flow.
- Simplified `docs/specification/` around app behavior, removed numbered
  requirement and slice markers, and restored the API direction.
- Clarified `README.md` and `REFINE.md` so guest locators are unprotected until
  an authenticated creator reserves their namespace.
- Added `REFINE.md` with a critical review of the generated specification:
  unstartable gating, silent scope reversal, dropped API direction, blocked
  Baselines, slice ordering, and concrete cross-reference defects.
- Replaced the draft README vision with a structured project specification
  covering product scope, user experiences, domain rules, capabilities, open
  technical requirements, critical ambiguities, risks, and task-oriented
  delivery slices.
