# Changelog

## 2026-07-18

- Planned the next delivery step: activated the `namespace-reservation` task
  (DS-PROTECT core - namespace ownership and publishing authorization) with a
  seven-part sub-task plan, and queued the `durable-storage` backlog task
  fixing the interface-pattern persistence approach with switchable backends
  (Postgres, MongoDB, Deno KV, ...) while in-memory remains the first
  legitimate implementation.

- Simplified dynamic local Google authentication configuration: a configured
  request-host pattern now takes precedence immediately, so request-derived
  callback and mock-consent URLs no longer require inherited static URL
  variables to be present as a pair.

- Added opt-in dynamic Google callbacks for preview deployments through
  `IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN`. Configured production callbacks
  remain unchanged when it is unset; enabled contexts require a full HTTPS
  request-host regex match, reject mismatches, ignore `Origin`/`Referer`, and
  use the selected URI for both authorization and token exchange without
  retaining an unbounded host cache. Local preview mode needs no static URL
  variables: it derives and validates its same-origin callback and mock-consent
  endpoints while warning that every matched host exposes fake sign-in.
  Documented Google's independent original- mode redirect registration
  requirement and added 9 tests (177 total).

- Fixed built-server authentication startup by keeping gauth and Effect out of
  circular SSR chunks. Added an environment-driven production runner with
  validated optional `PORT`, preserving Deno's port-8000 default when omitted;
  documented Deno Deploy configuration, excluded immutable task history from
  code-quality scans, and added 3 server configuration tests.

- Completed authentication acceptance. The configured local integration now
  covers sign-in, authenticated resolution, logout to a distinct fresh guest,
  and stale-bearer rejection; callback failures render a provider-neutral safe
  retry without reusable state or leaked values. Settled Google-first account
  entry/recovery separately from namespace authority, recorded a headless
  Chromium sign-in/logout smoke, and passed check, 165 tests, and production
  build.

- Reopened the authentication task after validating its original acceptance
  criteria. Its final step now covers the integrated logout-to-fresh-guest flow,
  safe callback retry presentation, settled authentication specification, local
  browser smoke, and final verification gates; namespace ownership remains a
  separate task.

- Added server-rendered site session navigation backed by an interface-first
  presenter. Guests can start Google sign-in and return to the validated current
  site URL; authenticated sessions expose signed-in state and a CSRF-protected
  logout form without passing identity or authorization decisions into UI
  components. Added 3 presenter/rendering tests (164 total).

- Added the development-only `/auth/google/mock-consent` boundary using gauth's
  package-rendered screen. It accepts only the exact local authorization query,
  stays unavailable in original mode, and applies no-store, restrictive CSP, and
  no-referrer headers. Added 4 tests, including the complete local browser
  start/consent/callback flow, logical-session upgrade, bearer rotation, and
  stale-guest rejection (161 total).

- Completed Google provider composition with startup-validated, explicit local
  or original gauth preset selection and strategy registration. Local fake auth
  is restricted to same-origin loopback callback/consent URLs; original mode
  requires client credentials and HTTPS outside loopback. Development now
  selects local mode explicitly. Added 4 configuration/composition tests (157
  total); the package-rendered mock consent route remains.

- Pinned `jsr:@kindkitchen/gauth@0.4.1` and its compatible direct Effect
  dependency, then added the thin provider-neutral `GoogleGAuthStrategy`
  adapter. It passes the exact OpenID/profile scope, application state, and
  callback URI; retains only the PKCE verifier as server-side attempt context;
  maps verified profile fields; discards provider tokens; and collapses raw
  provider failures. Added 4 adapter tests (153 total); preset composition and
  registration remain.

- Completed the provider-neutral authentication core with a bounded, form-only
  `POST /auth/logout`. Authentication now issues a 256-bit session-bound
  synchronizer token; logout validates it against repository state, atomically
  revokes the authenticated bearer, and publishes a distinct fresh guest session
  and credential. Added 5 lifecycle/HTTP tests (149 total); no provider strategy
  is registered yet.

- Added provider-neutral `GET /auth/:strategy/start` and callback HTTP
  boundaries with bounded query handling, one-use invalid-callback state,
  no-store redirects, browser-safe error mapping, secret-free diagnostics, and
  centralized rotated-cookie publication. Added 6 adapter/session-transition
  tests (144 total); no provider strategy is registered yet.

- Added session-owned OAuth attempts and provider-neutral authentication
  orchestration. Guest sessions now retain at most five 10-minute attempts with
  hashed one-use state and server-only provider context; callbacks consume state
  atomically before provider exchange, reject unsafe local returns, persist the
  stable external identity, and upgrade the logical session with bearer
  rotation. Wired the service at composition and added 7 attempt/orchestration
  tests (138 total).

- Added the first phase-2 authentication core: provider-neutral identity and
  strategy interfaces, an atomic process-local identity repository keyed by
  stable provider subject rather than email, and a multi-strategy registry with
  route-safe IDs and duplicate rejection. Wired the defaults at composition and
  added 10 identity/registry tests (131 total).

- Completed the session HTTP boundary with explicit production/local host-only
  cookie strategies, typed request context, unique server-owned request IDs, and
  root Fresh middleware. Routed success, redirect, API/error, missing, and
  direct-content responses receive pending cookies and diagnostics without
  changing status, body, length, existing cookies, or CSP isolation. Added 9
  cookie/composition/request-preservation tests (121 total).

## 2026-07-17

- Activated user authentication and implemented its transport-independent
  session lifecycle: interface-backed process-local storage, discriminated
  guest/authenticated state, hashed 256-bit bearer lookup, bounded renewal,
  revocation, and atomic logical-session upgrade with credential rotation.
  Reserved `auth`, documented the storage and HTTP boundaries, and added 10
  lifecycle/concurrency tests (112 total).

- Added an implementation-ready user-authentication task covering request IDs,
  guest/authenticated sessions, opaque cookie transport, multi-strategy auth,
  Google OAuth through `jsr:@kindkitchen/gauth@0.4.1`, its mocked local consent
  flow, security tests, and gated authenticated header/navigation follow-ups.

- Clarified exclusive content replacement controls as attached tabs:
  Markdown/CSS now meets the source panel edge and Raw/Steps meets its nested
  content panel. Selected tabs expose their controlled panel and support
  arrow/Home/End navigation. Split/full-width remains a detached, labelled
  layout control, while section type remains a draft-shape picker.

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
