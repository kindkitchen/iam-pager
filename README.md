# About

Site for content sharing through URLs. Any meaning of such content or any
relation between several pages with some content is at the author's initiative
and responsibility.

## Project vision (draft MVP)

`iam-pager` lets a person associate content with a deterministic URL built from
a namespace and an optional page name. Opening that URL should return the
content directly, without first showing the site's navigation or visual shell.

The site also lets visitors explore public pages and gives authenticated
creators a profile-oriented place to manage their own namespaces and content.
Because pages can have different formats, purposes, and sizes, creators may
eventually connect their own storage providers.

The two main product directions are:

- share or explore content, with direct HTTP and API behavior at its core;
- manage content through a rich, profile-oriented site.

Publishing is not limited to registered creators. Even a guest may publish
content, with stricter capacity, size, frequency, durability, and namespace
limitations. Guest namespaces are not reserved, so guest content may be replaced
by another guest or by an authenticated creator who uses the same namespace.
Content in a reserved namespace remains protected from guest writes.

## User stories

### Unauthenticated visitor

Anyone can:

- open a known public page URL and receive the raw content without the site UI;
- explore available public pages through the site;
- search by page name, author namespace, tags, and textual content when the
  content can be represented as text;
- inspect a public page in a thin site wrapper;
- continue from that view to the raw content, the author's default page, or the
  author's other public pages;
- publish content as a guest under the stated guest limitations.

A missing direct page should return a clear missing-page response rather than
silently pretending the main site is the requested content.

### Authenticated creator

A creator associates the account with a unique namespace. The namespace is
protected from guest and cross-user overwrite and gives the creator durable
control of its pages under the service's stated storage behavior.

An authenticated creator can:

- reserve a unique namespace;
- publish at a namespace-and-page-name URL;
- publish a default page at the namespace-only URL;
- make a page public or keep it available only to the creator's session;
- find managed pages by name, created or updated dates, views, and tags;
- delete or change access for selected pages in bulk;
- rename a page without conflicting inside the namespace;
- duplicate a page under an automatically generated name;
- create, inspect, change, and delete individual pages;
- reserve additional namespaces later;
- connect an external storage provider such as Google Drive or a GitHub
  repository later.

### Creator with external storage

This experience remains to be specified after first-party publishing works.

## What is a page?

A page is one logical managed/explored item associated with content. URLs and
content are separate: a page has one canonical locator and may expose additional
delivery endpoints for the same stored asset without becoming multiple pages.

### Page URL

A page locator contains a namespace and optionally a page name. A namespace by
itself can locate a default page.

An authenticated creator reserves a namespace and controls its pages. A guest
can use the same locator model without reserving the namespace or receiving an
ownership guarantee.

### Page content

Content can have different formats. It may be HTML, text, a PDF, an image, or
another supported type. Depending on the endpoint profile, a direct URL may
display the content or download it. PDF is the next planned type: one stored PDF
may have user-configured browser-native inline and attachment endpoints at
independently chosen valid locators.

## Current implementation

The first publishing slice currently provides:

- a path locator where the first segment is the namespace and the remaining
  segments are the optional page name; `site`, `api`, and `auth` are reserved;
- an interface-first session lifecycle, in memory by default or optionally
  backed by Deno KV, with guest/authenticated state, hashed bearer lookup,
  bounded renewal, atomic credential rotation, and revocation; root application
  middleware now gives every routed request a server-generated request ID and
  typed session, using an opaque host-only cookie without changing
  direct-content response bodies or isolation headers;
- provider-neutral authentication contracts, an interface-backed identity
  repository keyed by stable `(strategy_id, provider_subject)`, and a
  multi-strategy registry that rejects duplicate IDs; bounded, expiring OAuth
  attempts are owned by guest sessions with hashed one-use state, while the
  route-independent authentication service selects strategies, saves identity,
  upgrades the logical session, rotates its bearer credential, and issues a
  256-bit synchronizer token to trusted application UI; generic browser
  start/callback routes provide bounded query handling, no-store redirects,
  secret-free diagnostics, centralized publication of the rotated session
  cookie, and a provider-neutral site-owned callback failure page whose safe
  retry link retains no callback values; bounded form-only `POST /auth/logout`
  validates its CSRF token against repository state, atomically revokes
  authenticated access, and publishes a distinct fresh guest session and bearer;
  the pinned gauth 0.4.1 Google adapter maps exact authorization inputs,
  server-only PKCE context, and verified profile output without retaining
  provider tokens or exposing provider failures; startup configuration
  explicitly selects and composes the package's loopback-only local or original
  preset and registers Google; both modes keep their configured callback by
  default and can opt into full-regex-allowlisted HTTPS request hosts for
  dynamic preview callbacks; local mode derives its callback and mock-consent
  endpoints from that same trusted origin and serves gauth's package-rendered
  mock consent screen behind exact authorization-query validation, while
  original mode keeps that route unavailable; a server-owned site-navigation
  presenter maps the typed session to either Google sign-in with a validated
  local return or a CSRF-protected logout form, and components render that
  complete model without receiving session IDs or making authorization
  decisions;
- namespace reservation: an interface-backed service validates candidate names
  through the locator engine and atomically claims them case-insensitively for
  one owner; authenticated `GET`/`POST /api/namespaces` adapters list and
  reserve claims, the mutation requires the session's synchronizer CSRF token,
  and the site presents the creator's owned namespaces and reserve form;
  publishing derives its actor from the resolved session, rejecting guest and
  cross-user writes into reserved namespaces while allowing the owner; ownership
  is in-memory by default, or Deno KV can atomically persist users, external
  identities, and namespace claims together;
- the page-management core under `lib/page/`: stable opaque page IDs,
  trial/managed stewardship, access and revision invariants, an atomic
  repository contract with deterministic owner pagination, memory and Deno KV
  backends passing the same conformance suite, and an HTTP-independent
  `PageService` for trial publish plus managed create, list, source inspection,
  content/access update, deletion, revision-bound same-namespace rename,
  generated-name duplication, bounded per-page-result bulk access/deletion,
  owner-only private delivery, public wrapped viewing, and bounded
  namespace-public listing. Rename preserves stable page identity and atomically
  moves locator/owner indexes; duplication copies one exact source revision into
  a fresh identity. Both memory and Deno KV reject managed destination conflicts
  and may retire a pre-reservation trial at the destination. Public summaries
  omit page IDs, revisions, and owner identity; private and guest pages never
  enter creator listings. The durable adapter uses coherent ID/locator/owner
  indexes and immutable binary-safe content chunks in a fresh keyspace. The
  composition root selects one page repository and exposes this service plus its
  strict HTTP adapter to thin Fresh collection, item, action, bulk,
  direct-delivery, and wrapped-view routes. The current publishing form sends
  the nested explicit public-create request and creator CSRF token without
  losing draft state on API errors; see
  [the page API contract](docs/api/pages.md);
- `MdPage` content, derived from sanitized Markdown with optional CSS;
- the site shell and mobile-first guest/creator publishing form at `/` and
  `/site`, with soft in-field four-word random locator helpers, a collapsible
  Page workspace with exclusive Markdown/CSS source panes, split or full-width
  preview layouts, fullscreen preview, raw and guided Markdown section editing,
  fenced code-block sections, grip-driven section ordering and value merging,
  CSS-reactive sandboxed section previews, editable element-based CSS presets,
  CDN-backed CSS syntax highlighting, and a sandboxed live Markdown/CSS preview;
- a thin public wrapper at `/site/<locator>` with a sandboxed, no-referrer HTML
  preview or content fallback, direct-content and creator-default links, and
  bounded links to other public managed pages; trial pages remain known-locator
  only and private or missing pages share a real 404; `site`, `api`, and `auth`
  remain reserved as namespaces;
- public exploration on `/` and `/site`: an HTTP-independent
  `PublicPageExplorer` browses current public managed pages or applies
  case-insensitive namespace/page-name substring filters plus an exact tag
  filter with AND semantics. Results are deterministically cursor-paginated and
  open the public wrapper or direct content; memory and Deno KV satisfy the same
  exclusion and cursor conformance, so private and guest pages never cross the
  contract. The web form exposes both name fields and one exact tag;
  text-content search remains later work;
- `GET`/`POST /api/pages`, `GET`/`PATCH`/`DELETE /api/pages/:page_id`,
  revision-bound rename/duplicate actions, and per-page-result bulk
  access/delete commands for trial creation and authenticated page management,
  including tags, name/access/tag filters, pagination, owner-safe source
  inspection, CSRF, and revision ETags;
- authenticated `GET /api/namespaces` and CSRF-protected `POST /api/namespaces`
  for listing and reserving creator namespaces;
- raw delivery at every other valid locator, with explicit status, media type,
  length, cache, disposition, and active-content isolation headers;
- prototype limits of 96 KiB per guest API request, 64 KiB of Markdown, and 16
  KiB of CSS (all content limits are measured as UTF-8 bytes).

Pages, users, external identities, namespace reservations, and sessions are
process-local by default. Deno KV can persist linked ownership records, while
sessions and pages separately opt into that same database; either durable store
is rejected unless ownership is durable. Pages in unreserved namespaces remain
replaceable by anyone. Rename, duplicate, bounded tags, managed name/access/tag
filtering, public tag exploration, and explicit per-page-result bulk access and
deletion are exposed by the page API and creator site. The creator panel keeps
filter-bound pagination, refreshes stale rows, edits content and comma-separated
tags together, supports default/named renames and generated duplication, and
applies access or deletion to an explicit selection of at most 100 current row
revisions while showing one result per page. Total page capacity, publishing
frequency, guest expiry, exploration text indexing/relevance, and backend
migration are not implemented; these endpoints are not ready for untrusted
public traffic.

## Active direction: explicit pre-deploy

The next operational slice adds one explicit `deno task pre-deploy` graph. Deno
2.9 task-object dependencies will run check, test, and build branches in
parallel and invoke `pre-deploy::upgrade-db-schema` only after they all succeed.
The schema task always inspects durable state; it is not file-cacheable and
repeated runs must become successful no-ops once every registered upgrade is
complete.

Schema evolution remains outside application startup. A transport-independent,
forward-only runner compares each declared schema target with a persisted
version, resumes a stable idempotent step after interruption, and has no
rollback path. The first adapter stores upgrade state in Deno KV and uses atomic
claims so parallel invocations cannot apply one transition unsafely. Individual
one-way transform helpers remain explicit until every supported environment has
advanced past them.

## Backlog direction: PDF pages

The next chain first separates logical pages, immutable content assets, and
delivery endpoint bindings. One asset may back multiple locators while the page
keeps one ID, revision, access policy, management row, and exploration row. For
PDF, one configured endpoint can use `application/pdf` with inline disposition
and another configured endpoint can serve the same bytes as an attachment. The
publisher supplies both valid locators and each delivery profile. A path ending
in `.pdf` is only an example and has no special routing, generation, or delivery
semantics; behavior is stored on the endpoint binding.

The implementation order is pure endpoint/content contracts with a memory
reference, PDF content logic, a conforming Kvdex-backed Deno KV page/content
adapter, strict bounded upload/direct delivery, and finally the site projection.
Kvdex remains inside the adapter. Its segmented blob writes do not by themselves
preserve the repository's atomic visibility guarantees, so immutable assets must
be fully staged before page endpoints can reference them. Existing raw Deno KV
records require explicit compatibility or migration before that adapter becomes
the durable default. Generic raw-binary publishing, PDF.js, thumbnails, text
extraction, and external storage remain later work.

## Local development

Run `deno task dev`, open `http://localhost:5173`, browse or search current
public creator pages, draft Markdown and CSS with the live preview, publish the
page, and use the resulting link to open its direct URL. Prefix that locator
with `/site` to open the wrapped public view. The development task explicitly
sets `IAM_PAGER_SESSION_COOKIE_MODE=local`, selecting the non-secure
`iam_pager_session_local` cookie for localhost. It also explicitly selects the
local gauth preset with the localhost Google callback and mock-consent URLs.

The site's `Sign in with Google` header action starts the local sign-in flow,
and the package-rendered consent screen returns through the callback to the
current local site URL with an upgraded browser session. A failed callback shows
a site-owned retry page without preserving reusable callback state. An
authenticated header shows only signed-in state and the CSRF-protected
`Sign out` action; signing out revokes that authenticated bearer and immediately
rotates the browser to a distinct guest session. Signed-in creators can reserve
and list namespaces through the creator panel, then publish into their own
claim. The creator management panel lists and filters pages by name, access, and
exact tag; inspects and edits content/tags; changes individual access; renames,
duplicates, and deletes; and applies access or deletion to an explicit bounded
selection. Every mutation uses the revision-bound management API, stale
individual results refresh their rows, and bulk commands show one outcome per
selected page. Public tag exploration remains available through site search.

Every other entry point defaults to the production `__Host-iam_pager_session`
cookie with `Secure`; do not set local session-cookie mode in a deployed
environment. Google local mode may be used only in explicitly designated preview
environments because it grants fake authentication to anyone who can reach a
matched host. Original Google authentication requires
`IAM_PAGER_GOOGLE_AUTH_MODE=original`, `IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI`,
`IAM_PAGER_GOOGLE_AUTH_CLIENT_ID`, and `IAM_PAGER_GOOGLE_AUTH_CLIENT_SECRET`;
configuration is validated before the shared application services are created. A
preview environment in local or original mode may also set
`IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN` to a narrow project-specific
regular expression such as `iam-pager-pr-[a-z0-9-]+\.example\.com`. When unset
or empty, the configured redirect URI remains authoritative. When set, the
complete case-insensitive request host (including a non-default port) must match
and the request URL must use HTTPS; then `/auth/google/callback` is built
against that request origin with the URL API. Local mode also builds
`/auth/google/mock-consent` against the same origin and validates that its
requested callback is same-origin. In dynamic local mode the request-host
pattern is authoritative and the two static URL variables are ignored because
neither endpoint needs a configured origin. This also permits deployments that
still inherit only one of those static variables:

```env
IAM_PAGER_SESSION_COOKIE_MODE=production
IAM_PAGER_GOOGLE_AUTH_MODE=local
IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN=iam-pager-pr-[a-z0-9-]+\.example\.com
```

A mismatch is rejected rather than falling back or redirecting. The application
deliberately uses `Request.url`, not optional or caller-controlled
`Origin`/`Referer` headers. In original mode, Google still requires every
resulting redirect URI to be authorized for the OAuth client; this application
regex does not create wildcard support at Google. Static/framework assets served
before Fresh application routing intentionally receive neither session state nor
a request ID. Markdown can be edited as raw source or as guided sections; both
modes update the same draft. The deterministic section adapter groups a fenced
code block into one editable unit while retaining unfamiliar Markdown as safe
one-line raw sections instead of approximating a full Markdown AST. Collapsed
sections render in isolated frames with the current page CSS and toggle their
controls when tapped. Each preview measures and shows its complete rendered
content by default; its quiet `Compact`/`Whole` action preserves that individual
choice across content saves, focus changes, reordering, and removal. Text,
Heading, Link, Code block, and raw Markdown have focused forms; Code block
exposes optional language and multiline code fields. For Text, Heading, and
Link, `Is list item` enables an adjacent `Numbered` checkbox on the same line:
unselected means bulleted. Empty Text represents a blank physical line. Every
content field integrates quiet Paste, Copy, and Clear actions into its input
header; blocked code clipboard reads focus the multiline field for direct paste.
The plus button appends a section. Drag a grip between sections to reorder, or
over the center of another section to combine the dragged section's primary
value with it and remove the original card. The destination keeps its type:
focused one-line values join with a space, while Code block values join with a
newline. Mouse, touch, and pen support both drop modes, while focused-grip arrow
keys reorder. Choosing a CSS preset replaces the current CSS, which remains
editable in a Prism-highlighted textarea. Markdown/CSS and Raw/Steps are
interchangeable-content controls rendered as tabs attached to the panel edge
they replace; selected tabs expose their controlled panel and support arrow,
Home, and End navigation. The detached split/full-width control remains a layout
choice. Markdown and CSS occupy the same source position rather than appearing
together. The Page workspace can collapse without losing its selected source or
layout; `Split with preview` places source and preview beside each other where
space permits, while `Full width` places the preview below. Preview can also
enter browser fullscreen. Random locator actions sit inside their subdued field
headers; suggestions are browser-only conveniences and do not check server
availability. Draft preview renders locally in the browser inside a sandbox;
authoritative validation and sanitization run through `MdPageHandler` only when
publishing. Keep the development server running because guest pages are stored
only in that process. Site styling is loaded by the site shell only; it is not
injected into direct page responses.

## Production startup and deployment

Build first, then start the generated server with a production environment file:

```sh
deno task build
deno task --env-file=.env.production.local start
```

`PORT` is optional. When set, it must be an integer from 0 through 65535; when
omitted, `Deno.serve` retains its port-8000 default. A deployed instance
requires original Google mode and its callback URL, client ID, and client secret
variables listed above.

### Storage profiles

Database availability and repository selection are separate. Attaching a Deno KV
database to a deployment only makes it available to `Deno.openKv()`; it does not
select any application backend. An unset backend, or an explicit `memory` value,
keeps that repository process-local.

For a Deno Deploy production context that must preserve sign-in, namespace
reservations, and published pages, attach a KV database to that context and set
all three backend variables there:

```env
IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv
IAM_PAGER_SESSION_STORAGE_BACKEND=deno-kv
IAM_PAGER_CONTENT_STORAGE_BACKEND=deno-kv
```

Leave `IAM_PAGER_OWNERSHIP_DENO_KV_PATH` unset on Deno Deploy so every adapter
uses the attached default database. Scope these values to the production
context. Changing backend selection does not migrate process-local records or
sessions; deploy the new configuration and sign in again.

For local development or an intentionally ephemeral preview, omit all three
backend variables or set them explicitly:

```env
IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=memory
IAM_PAGER_SESSION_STORAGE_BACKEND=memory
IAM_PAGER_CONTENT_STORAGE_BACKEND=memory
```

`deno task dev` already uses the unset, in-memory default. Memory is reliable
for a single local process, but not for a serverless preview: requests may reach
different instances or an instance may restart. A bearer upgraded during a
successful sign-in can then be unknown on the next request, which intentionally
creates a fresh guest session. The visible symptoms are another sign-in prompt
or `not_authenticated` failures from namespace reservation and creator
publication. Use Deno KV for any preview where authentication or publication
must work reliably across requests.

A self-hosted durable process can use the three `deno-kv` settings with an
explicit durable filesystem path:

```env
IAM_PAGER_OWNERSHIP_DENO_KV_PATH=/var/lib/iam-pager/ownership.kv
```

Deno KV selects the linked identity and namespace repositories as one ownership
unit; sessions and pages remain separate opt-ins. Durable sessions and durable
pages each require Deno KV ownership and inherit its exact path or default
database. Startup rejects either option with memory ownership, preventing an
authenticated session from surviving without its user record and a published
page from surviving without its namespace reservation. Omitting either opt-in
keeps that store in restart-invalidated memory even when ownership is durable.

The Deno KV session adapter atomically preserves creation, renewal,
authentication-attempt consumption, credential rotation, logout, and revocation.
For browser bearers and OAuth state it stores only hashes, never raw values.
Session records and credential indexes receive the absolute-session-lifetime KV
TTL; idle and absolute expiry remain enforced by the service because KV expiry
is lazy, and logout/revocation removes the credential index atomically.

The Deno KV page adapter stores each page as an envelope record plus immutable
generation chunks, so a page's Markdown source and derived HTML are not limited
by the single-value size cap. Replacement writes the new generation's chunks
first and then atomically flips the envelope while deleting the replaced
generation: readers always see one complete page, and concurrent replacements
settle on exactly one winner. A crash between chunk writes and the flip can only
orphan chunks of a never-referenced generation. Changing the backend or
ownership path does not migrate or merge records. Ownership records still have
no application expiry or deletion path, and backup/recovery follows the selected
KV service or deployment operator. Without the content opt-in, pages still
disappear on restart.

For Deno Deploy, use `deno task build` as the build command and
`_fresh/server.js` as the application entrypoint. Apply the appropriate storage
profile above to each production or preview context. Configure the original-mode
Google variables for every deployment context that must warm successfully. The
callback must be an authorized HTTPS `/auth/google/callback` URL for the domain
used by that context. Dynamic preview contexts using local mock authentication
can set `IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN`; they do not contact
Google, but every matched host intentionally permits fake sign-in and must not
be treated as a production environment. If original mode uses the pattern, every
selected callback must still satisfy Google's redirect-URI registration rules.
Original preview hosts that cannot be registered individually require a stable
callback broker rather than a broader application regex. The SSR build
deliberately leaves gauth and Effect as runtime imports so loading the selected
preset cannot deadlock through circular bundle chunks.

## Technical stack

- TypeScript with strict checks
- Deno as the JavaScript runtime
- Deno Fresh as the web framework
- Prism 1.29 from jsDelivr for CSS editor highlighting
