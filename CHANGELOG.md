# Changelog

## 2026-07-27

- Moved the "External content unavailable" list filter out of the primary
  management filter row into a secondary "More" disclosure, relabelled it as an
  explicit repair view with a description, and kept an applied maintenance
  filter announced in the disclosure summary.
- Added `managed_maintenance_filters` and `managed_maintenance_filter_state` to
  `lib/ui/page-management.ts` so the maintenance-versus-everyday filter
  distinction lives in code rather than in the web representation.

## 2026-07-25

- Restricted the unprotected-page notice on `/site/publish` to guests; creators
  publish only into namespaces they own and no longer see it.
- Reworked the publish surface for editing: one frame per editor area instead of
  nested tab boxes (the Markdown/CSS and Raw/Steps choices remain), the
  Raw/Steps control shares the tab row on wide screens, layout and visibility
  controls moved into the editor heading, and the duplicated in-form publishing
  heading was dropped.
- Widened the publish route to a centred `108rem` shell: setup fields form a
  three-column band on very wide screens while the editor and preview span the
  full width with viewport-relative heights.
- Rearranged web navigation around one server-owned site map
  (`lib/ui/site-map.ts`): the home page (`/` and `/site`) is now a pure
  navigation hub of grouped destination cards, and top navigation, hub cards,
  and breadcrumbs are all projections of that single declaration.
- Moved page generation to its own full-width route `/site/publish`, together
  with namespace reservation and the guest-exposure notice; home no longer
  embeds the publish form or the management panel, and `/site/manage` now also
  carries namespace reservation.
- Added `/site/about`, `/site/demo`, and a guest-only `/site/invite`
  destination, rendered from one editorial presenter
  (`lib/ui/site-editorial.ts`) through one component; signed-in creators get
  creator next steps on the invitation route instead of the sign-up pitch.
- Replaced the bare `Downloadable` checkbox in publishing and in "Edit paths"
  with an explicit two-option delivery control (open in browser / download)
  shared by both islands, and restyled the remaining bare checkboxes
  (external-content filter, Markdown list toggles) as consistent toggle fields.
- Extracted the shared site header (`components/SiteNavigation.tsx`) used by
  every destination, replacing `components/SiteApp.tsx`.

## 2026-07-24

- Fixed real Google reauthentication after logout using a request-derived,
  unregistered callback: `original` mode now always sends its exact configured
  redirect URI, while dynamic hosts remain limited to local mock previews. Added
  a full sign-in/logout/sign-in callback-stability regression and clarified that
  iam-pager logout does not clear the browser's Google session.

## 2026-07-23

- Fixed Google Drive publication rejections being reported as missing external
  files; upload-specific 403 responses now use the provider-unavailable path
  while inaccessible existing files retain non-disclosing missing semantics.
  Production setup now explicitly requires enabling the Google Drive API.
- Fixed production Google Drive consent callbacks to accept Google's bounded
  authorization-response metadata (`iss`, `scope`, `authuser`, and `prompt`),
  validate the optional issuer, avoid token requests for malformed callbacks,
  and permit the callback failure page's same-origin favicon under CSP.
- Fixed local Google Drive OAuth to inherit Google auth's validated preview-host
  pattern when no Drive-specific override or complete static URL pair exists,
  avoiding a static mock-consent URL requirement on dynamic preview deployments.
- Hardened credential-free Google Drive OAuth for HTTPS previews with explicit
  local-mode composition coverage, mode-aware credential errors, complete
  environment examples, and documented request-host allowlisting semantics.
- Added a complete, credential-free environment catalog with runtime-context and
  plain-text/secret annotations, plus a Deno Deploy setup guide covering safe
  private copies, dotenv batch import, secret-name inference, and the lack of
  file syntax for automatic context assignment.
- Fixed alias-correlated page and asset loss caused by page storage silently
  falling back to process memory: runtimes now require explicit storage
  backends, retain the former page selector for deployment compatibility, and
  verify that alias updates preserve assets across Deno KV reconstruction.

## 2026-07-22

- Completed creator-facing external storage: a browser-owned connections API
  lists token-free provider metadata and initiates or disconnects Google Drive;
  `/site/manage` now presents connection status, reconnect/disconnect controls,
  and the dependent-page warning. Active write-capable connections appear in
  publish and revision-bound replacement flows for Markdown and PDF. Selected
  external writes validate and render canonical bytes, upload before commit,
  persist payload-free assets with SHA-256/codec facts, and never silently fall
  back inline. Added API/specification docs and end-to-end service, HTTP,
  multipart, presenter, and component coverage.
- Added owner-facing external-content health and repair management. Managed page
  summaries now expose safe missing causes and detection times, list cursors
  bind a strict missing/healthy filter, and the creator UI shows affected-page
  indicators, warnings, and repair controls. Inline replacement detaches from
  external storage; a new revision-bound re-link action stats and fetches a
  byte-identical file through the existing owner-proven connection, creates a
  fresh immutable asset, and clears health without exposing storage details to
  visitors.
- Added external content delivery for direct and site-wrapper visitors: provider
  bytes are fetched within local bounds, verified against authoritative size and
  SHA-256 facts, and served with existing endpoint semantics. Missing, revoked,
  integrity-failed, unregistered, and retryable sources return one bounded
  platform-owned `503` placeholder without leaking storage details. Definitive
  failures persist asset-bound, revision-neutral page health in memory and Deno
  KV; repeated observations are idempotent and verified recovery clears the
  state. Google Drive now preserves the safe revoked cause, while transient
  failures remain non-mutating.
- Added the production `google-drive` external-storage provider with an injected
  Drive v3 HTTP gateway, bounded stat/media reads, multipart writes carrying
  `md5Checksum` version hints, single-flight persisted token refresh, definitive
  revocation and missing mapping, retry-safe outage mapping, registry
  composition, an in-process fake Drive server, and provider-conformance and
  error-mapping coverage. Local consent mode remains provider-free; original
  mode registers the adapter from its dedicated Drive client credentials.
- Added a second, explicit `@kindkitchen/gauth` composition for Google Drive
  storage consent with its own `IAM_PAGER_GOOGLE_DRIVE_*` registration, exact
  callback routes, `drive.file` permission, offline explicit consent, and full
  local mock flow. Authenticated-session-bound one-use state uses a separate KV
  prefix; callbacks create or reauthorize encrypted storage credentials while
  preserving omitted refresh tokens, and CSRF-protected disconnect attempts
  Google revocation before always destroying local credentials. Added thin Fresh
  routes, persistence composition, configuration docs, and roundtrip, mismatch,
  unauthenticated, replay, and revocation regression tests.
- Added the creator storage-connection model and repository boundary with strict
  owner-safe metadata, one active connection per user/provider pair, retained
  revocation records, same-account reauthorization, provider-only credential
  access, and shared memory/Deno KV conformance. The KV adapter stores tokens
  separately as randomized connection-bound AES-256-GCM ciphertext, fails closed
  on malformed state, and atomically destroys credentials on revocation; the
  memory implementation is a fault-injectable test double.
- Added provider-neutral external sources to immutable `ContentAsset` records:
  external assets carry a bounded provider reference plus required local
  checksum and codec facts, never contain inline data, and round-trip through
  memory and Deno KV repositories without creating payload objects. New inline
  records use an explicit source discriminator while existing source-less KV
  manifests decode as inline without migration; repository conformance now
  covers both source kinds.
- Added the provider-neutral external-storage interface family under
  `lib/external-storage`: bounded opaque references and fetches, mandatory
  read/stat with optional write/delete capabilities, normalized definitive
  missing versus retryable unreachable outcomes, a validated provider registry,
  reusable adapter conformance tests, and an isolated in-memory reference
  provider with fault injection. External storage remains unavailable until the
  connection, asset-source, delivery, and management slices land.
- Specified external content storage before implementation: iam-pager keeps
  authoritative asset metadata locally, proxies and verifies provider payloads,
  requires provider read while advertising optional write/delete, stores storage
  OAuth tokens encrypted and separately from sign-in, and returns a
  non-disclosing `503` placeholder only after page eligibility when external
  bytes are missing or unreachable. The README and product, domain, experience,
  capability, quality, and risk specifications now carry this selected but
  not-yet-available boundary.
- Drafted the external-content-storage task chain (`tasks/todo/`): epic plus
  nine ordered tasks covering specification, the storage-provider interface
  family with conformance suite, external-source support in the content-asset
  model, per-user storage connections with token custody, a separate Google
  Drive OAuth registration reusing `@kindkitchen/gauth`, the Drive provider,
  delivery-time fallback with placeholder content for externally deleted files,
  the owner warning and repair flow, and the management API/UI surface.
- Closed the API-key specification and regression boundary. The specifications
  now carry the API-key invariants (`SA-APIKEY`, `CP-APIKEY`, `CP-API-AUTH`,
  `EX-AUTOMATE`, plus updated `PD-CREATOR`, `QT-AUTHORITY`, `QT-API`,
  `QT-VERIFY`, `OS-LIMITS`, and `SP-CORE`), a new `docs/api/authentication.md`
  fixes cookie-versus-Bearer resolution, CSRF policy, stable errors, and the
  complete permission matrix, and the stale "until the resolver lands" claim in
  the API-key contract is gone. README gained a bearer usage example with
  permission semantics and a security warning. A new contract-matrix test drives
  every page, namespace, and key-management endpoint with guest, browser owner,
  mapped-permission key, under-privileged key, revoked key, and invalid bearer
  principals.

- Authorized API-key bearers over the existing page and namespace API. A new
  `lib/api-auth/` module resolves every `/api/**` request to a guest,
  browser-user, or API-key principal (`ApiRequestAuthenticator`) and applies the
  documented permission matrix (`ApiOperationPolicy`): `read` for list/inspect,
  `write` for create/update/rename/duplicate/bulk access and namespace
  reservation, `delete` for page delete/bulk delete. A presented
  `Authorization: Bearer` header is authoritative — invalid bearers fail with
  one non-disclosing `401` challenge and never fall back to the cookie — and the
  request middleware serves bearer requests from an ephemeral guest view, so no
  session is stored or cookie issued solely for a bearer request.
  Key-authenticated page creation is always managed; guest browser trial
  publication is unchanged.

- Added durable API-key persistence: a strict `DenoKvApiKeyRepository` with
  atomic create/update/revoke commits and an owner-generation bump for
  linearizable, unbounded revoke-all; one shared repository conformance suite
  now runs against both the memory reference and Deno KV. Durable keys are
  selected with `IAM_PAGER_API_KEY_STORAGE_BACKEND=deno-kv` through a new
  storage factory that inherits the ownership database, so key owner IDs cannot
  outlive durable identities. Malformed stored records fail closed.

- Added the owner API-key management page at `/site/api-keys`: generate keys
  with permission and expiry controls, one-time bearer reveal with a copy
  shortcut, inline edit, revision-bound revoke, and confirmed revoke-all. The
  page is a thin projection over `/api/api-keys` — the presenter and request
  builders live in `lib/ui/api-key-panel.ts` and components make no
  authorization decisions. Also fixed the pre-existing `deno task check`
  failures (`static/site.css` formatting, `CssSourceEditor` timer type).

- Improved API-key management UX with the shared four-word random label helper,
  compact styled permission checkboxes, an explicitly optional expiry date whose
  time defaults to the current local time, and an icon-only one-time-key
  visibility control. API keys now inherit durable ownership storage by default,
  so keys remain listed across reloads without requiring a newly introduced
  deployment setting.

- Implemented the owner API-key lifecycle as a new `lib/api-key/` sibling
  module: interface-backed model, service, memory repository, and HTTP adapter
  with thin Fresh routes at `/api/api-keys`. Browser-authenticated owners
  create, list, inspect, update, and revoke scoped keys with one-time bearers,
  strict bounds, CSRF, and strong ETags; bearer-authenticated revoke-all with
  the `delete` permission is the only key operation an API key can perform.
  Documented the wire contract in `docs/api/api-keys.md`.

## 2026-07-21

- Added the `api-keys` specification-first implementation task: browser owners
  manage scoped, expiring keys; standard Bearer principals can exercise mapped
  owner API capabilities but only revoke all keys; persistence, HTTP, web, and
  regression work follow as independently tested links.
- Improved creator publishing namespace controls: owned namespaces are rendered
  as non-editable selectors, newly reserved namespaces become available without
  a reload, and selector styling now matches the path editor.
- Added a designed 404 page with a prominent route to public exploration and a
  secondary home link, including the same recovery actions in missing wrapped
  page views.
- Added browser-friendly direct-content 404 responses and a deployment smoke
  check verifying that direct, framework-level, and wrapped-page failures return
  HTML with a `Go home` link to `/site`.
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
