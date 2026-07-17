# Changelog

## 2026-07-17

- Clarified exclusive content replacement controls as attached tabs:
  Markdown/CSS now meets the source panel edge and Raw/Steps meets its nested
  content panel. Split/full-width remains a detached, labelled layout control,
  while section type remains a draft-shape picker.

- Completed the softer guest editor hierarchy: Random is now a quiet action
  inside each locator field, labels and optional controls are less prominent,
  and the collapsible Page workspace switches between Markdown/CSS without
  mounting both source panes visibly. Added `Split with preview` and
  `Full width` layouts with preserved state and browser fullscreen preview.
  Guided cards now measure and show whole styled content by default; per-card
  Compact/Whole choices survive saves, focus changes, moves, and removal. Steps
  field actions now belong to quiet input headers. Added six tests for the
  interface-backed workspace and section-density controllers (102 total);
  responsive and interaction smoke checks pass.

- Added drag-to-merge for Steps sections: card centers now propose an absorbing
  drop target, the destination combines the source's primary value while the
  source card disappears, and edge/final targets retain reordering. One-line
  destinations use a space and Code blocks use a newline; no HTML break tags are
  generated. `Numbered` now remains beside `Is list item`. Added 4
  section-engine tests (96 total).

- Evolved Steps from line controls to lossless Markdown sections. Fenced code
  blocks are grouped and edited as one section with language and multiline code
  fields; Text/Heading/Link list membership uses `Is list item` plus a nested
  `Numbered` checkbox, while empty Text remains the blank-line representation.
  Append-only creation and grip-driven mouse/touch/keyboard ordering replace
  Up/Down/Above/Below buttons and expose a final drop target. Section previews
  remain CSS-reactive sandboxes, and the CSS source retains pinned CDN-backed
  Prism highlighting. Added 6 section-engine tests (92 total).

- Made live preview fully client-side with browser-compatible `marked`; draft
  preview remains isolated in the sandbox while authoritative sanitization stays
  at publish time, and the temporary preview POST endpoint was removed.
  Published links now open in the current tab so Back returns to the editor, and
  Markdown starts with a short usable draft instead of a placeholder. Preview
  coverage is now 3 client tests (78 total).

- Fixed Firefox live-preview failures caused by the client island importing the
  server-oriented `@deno/gfm` dependency graph, whose npm sanitizer transitively
  requested `node:url` and `node:path`. `MdPageHandler` now stays behind a
  bounded internal preview endpoint; the browser uses a debounced Fetch adapter,
  reducing the island from roughly 1 MB to a browser-native module graph. Added
  5 preview adapter tests (80 total).

- Improved the guest publishing UX without changing publishing logic: the
  mobile-first form now prefills a four-word random namespace, offers random
  helpers for both locator fields with local numeric collision fallback, and
  provides a Page editor with All, Preview, and CSS views. Markdown and editable
  element-oriented CSS presets update a sandboxed live preview through the
  existing `MdPageHandler`. Added 3 random-name tests (75 total).

- Fixed blank guest pages under `deno task dev` by scoping the site stylesheet
  to the Fresh app shell instead of Vite's global HTML injection, which had
  invalidated raw delivery `Content-Length`; standalone Markdown pages now also
  declare a data favicon to avoid the sandboxed CSP blocking `/favicon.ico`.

- Added the first guest creation flow: bounded `POST /api/pages` JSON publishing
  over `PublishingService`, direct-path/URL responses with explicit API errors,
  a Fresh guest `MdPage` form at `/` and `/site/*`, and clear replaceable,
  process-local ownership warnings. Publishing now rejects locators that do not
  round-trip through the active URL strategy; `MdPage` enforces 64 KiB Markdown
  and 16 KiB CSS limits, while the API bounds request bodies at 96 KiB. 15 new
  tests (72 total).

- Wired the domain layer to HTTP: composition root (`lib/app.ts`, `site` and
  `api` namespaces forbidden), routing-agnostic delivery response mapping
  (`lib/publishing/http.ts` — intentional status, content type, length,
  `no-store` cache policy, inline/attachment disposition, active-content CSP
  sandbox and `nosniff`), catch-all raw delivery route (`routes/[...path].ts`),
  and the site shell served at `/` and the `/site` alias
  (`components/SiteApp.tsx`, `routes/site/`). Removed the remaining Fresh
  scaffold counter, API, and middleware demos. 9 new tests (57 total).

- Added the publish/deliver use-case layer (`lib/publishing/`): `PagePublisher`
  / `PageDeliverer` interfaces and the `PublishingService` implementation that
  owns the `validate -> derive` invariant (publish is the only producer of
  stored records) and settles meta reconciliation — `ContentMeta` is computed
  from the deterministic `render` output at publish time. 11 new tests (48
  total).

- Implemented the first content type `MdPage` (`lib/content/md-page.ts`,
  `@deno/gfm` with sanitized publish-time html derivation, optional css with
  style-tag breakout neutralized) and the in-memory `ContentRepository`
  (`lib/content/memory-repository.ts`); reworked the repository interface around
  `PageRecord` so stored pages keep publisher-supplied locator casing. 14 new
  tests (37 total).

- Implemented the routing-agnostic locator layer under `lib/locator/` (locator
  model with case-insensitive identity key, strategy interface, engine with
  forbidden-namespace policy, first `path-slug` strategy) and the
  interface-first content contracts under `lib/content/` (`ContentTypeHandler`,
  `ContentRepository`, delivery metadata), with 23 tests and a `deno task test`
  task.
- Activated task `content-publishing` with a design analysis and a code review
  entry.

- Made Steps Paste usable when Clipboard API reads are blocked: it now opens an
  explicit manual-paste fallback and preserves physical-line normalization.

- Added Copy to every Steps content field alongside Paste and Clear, with
  clipboard success and denied-access feedback.

- Refined Steps after review: collapsed lines are now content-only previews and
  toggle their controls, existing lines can change type while preserving their
  primary value, every content input has Paste and Clear actions, and a final
  plus button always exposes end insertion. Added a type-conversion engine test
  (86 total).

- Added a switchable, mobile-first Steps mode to the `MdPage` Markdown editor. A
  lossless physical-line engine keeps raw Markdown authoritative while compact
  line previews support focused updates, guarded deletion, movement, and
  insertion above or below. The add flow covers text, six heading levels,
  bulleted and numbered lists, two-field links, and blank lines; oversized
  line-heavy drafts fall back safely to Raw mode. Added 7 deterministic engine
  tests (85 total).

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
