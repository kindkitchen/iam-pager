# Quality and technical requirements

## QT-STACK — Existing stack

- Product code uses strict TypeScript.
- The runtime is Deno.
- The web app uses Fresh with Preact and Vite.
- Site UI is designed mobile-first, with wider layouts added as progressive
  enhancements.
- `deno task check` is the minimum repository validation command.

The stack does not by itself decide storage, authentication, search, or safe
content delivery.

## QT-BOUNDARIES — Agnostic implementation boundaries

Product behavior should not depend on replaceable integration choices where a
stable domain boundary is practical:

- locator operations use a namespace and optional page name without assuming a
  path, subdomain, or other public URL mapping;
- an HTTP routing boundary maps requests and generated URLs to that locator
  model;
- publishing and management behavior is shared by the site and API rather than
  implemented separately for each interface;
- content bindings do not assume that all content always comes from one storage
  implementation;
- authentication, search, and external provider choices do not define page,
  namespace, or access behavior.

A concrete deployment still selects integrations and a public URL mapping, but
those choices should not require rewriting the corresponding product rules.

## QT-ROUTING — Routing and HTTP behavior

- Namespace and page matching must follow `DA-LOCATOR` consistently during
  publishing and retrieval.
- Locator uniqueness and replacement rules must remain correct when requests
  arrive at the same time.
- Page routes must not consume management, API, framework, or static-asset
  routes.
- Direct responses must use an intentional status, content type, length, cache
  policy, and display or download disposition.
- Invalid and missing direct URLs must not masquerade as a successful home-page
  response.
- Content updates must not expose a new payload with stale metadata or the
  reverse.

The current prototype maps `/` and `/site/*` to the site, reserves `site`,
`api`, and `auth` as namespaces, and maps every other unclaimed path through the
path-slug locator strategy. Replaceable guest content uses `no-store` until
validators exist. Active HTML and SVG delivery must receive an origin-less
sandbox and a restrictive content security policy in addition to content
sanitization.

## QT-CONTENT — Content handling

- The accepted formats and size limits must be explicit.
- Text and binary content must both be possible within the supported set.
- The service must not trust a filename alone to choose a media type.
- Upload and delivery should avoid unnecessary whole-file buffering when larger
  supported content makes that impractical.
- Active formats such as HTML and SVG need a delivery boundary that prevents
  them from reading or changing authenticated management state.
- Unsupported or unsafe-to-preview content can be downloaded instead of embedded
  in the site view.

The first supported set can be small, but the design should not assume that all
future pages are short text. The current `MdPage` form previews Markdown and CSS
locally inside a sandboxed iframe, without a preview HTTP request. Its Page
workspace is collapsible without resetting the selected source or layout;
Markdown and CSS are mutually exclusive source panes. Markdown/CSS and Raw/Steps
use attached tabs because they replace interchangeable content immediately below
them. Tabs expose selected/control/panel semantics with roving focus and arrow,
Home, and End navigation. Split/full-width remains a detached segmented control
because it rearranges the same content rather than replacing it.
`Split with preview` places source and preview side by side where space permits,
while `Full width` places the preview below, and the preview can enter browser
fullscreen. Markdown has switchable raw and guided section editors backed by the
same source string. The guided adapter must losslessly derive sections from
untouched source without approximating a full Markdown parser: safe focused
forms may stay one physical line, unfamiliar Markdown remains a raw one-line
section, and complete or unterminated fenced code blocks are grouped as one
multi-line section.

Collapsed sections are content-only previews rendered in isolated frames with
the current page CSS; activating one toggles its focused controls and closes the
previously active section, with unsaved changes guarded. Each card measures and
shows its whole rendered content by default, while a per-card Compact/Whole
preference follows source updates, focus changes, reordering, and removal. The
measurement frame permits same-origin inspection but still prohibits scripts;
the full-page preview retains its stricter opaque sandbox. Focused forms support
value-preserving safe type changes and integrate field-level Paste, Copy, and
Clear actions into quiet input headers. Code block sections expose optional
language and multiline code fields, generate a non-conflicting fence when
changed, and cannot convert to a one-line type while multiline content remains.
Text, Heading, Link, Code block, and raw Markdown are content types. For focused
one-line content, an `Is list item` checkbox enables an adjacent `Numbered`
checkbox on the same line; unchecked Numbered means bulleted. Empty Text
represents a blank physical line. Fenced code blocks remain standalone because
list-owned fences require coordinated indentation across the whole block.

New sections append at the end. A prefixed drag grip and visible insertion/final
drop indicators replace directional and contextual insertion buttons. Dropping
between cards reorders; dropping over a card's central merge target removes the
dragged card and combines its primary value with the destination, without
retaining the source Heading, Link, list, or code-block syntax. The destination
type remains authoritative: one-line fields use a space and Code block values
use a physical newline. The editor must not inject HTML break tags for this
operation. Pointer Events support mouse, touch, and pen, while focused grips
support keyboard arrow, Home, and End ordering with live announcements. Paste
must fall back to explicit manual entry when browser clipboard reads are
unavailable or denied. Structured editing is presentation logic only and does
not replace the publish input or server content handler. This draft
representation is intentionally simple; authoritative validation and
sanitization remain in the server-side content handler at publish time, keeping
Deno/server dependencies out of the browser module graph. CSS presets contain
element-oriented starting styles and replace the editable CSS draft when
selected. The CSS textarea remains the source while pinned CDN-hosted Prism
provides optional syntax highlighting.

## QT-LIMITS — Publishing limits

Publishing needs configurable content-size, stored-size, page-count, and
frequency limits. Guest publishing uses stricter values and may have shorter
retention. The app must explain when a limit rejects or removes content.

The current prototype bounds a guest publishing request at 96 KiB and accepts up
to 64 KiB of Markdown plus 16 KiB of optional CSS, measured as UTF-8 bytes.
These are initial operational values, not a promise for every future content
format. Total stored-page capacity, publishing frequency, and guest expiry are
still unimplemented.

## QT-AUTHORITY — Authenticated boundaries

- A page mutation in a reserved namespace requires authority from that
  namespace's owner.
- Knowing a private page URL is not sufficient to read it.
- Unauthenticated publishing cannot replace a protected page.
- Site controls must not trust owner or namespace values supplied only by the
  browser.
- Session behavior must protect state-changing operations from unrelated sites
  and creator-supplied page content.

The session foundation keeps transport and storage separate. A browser bearer
credential is opaque; only its hash is stored. Every request reaching
application routing now resolves to a guest or authenticated server-side
session, never a caller-selected identity or a nullable state, and receives a
new server-owned request ID. Production uses an explicit secure host-only
cookie; localhost uses a distinct configuration selected by the development
command. Middleware adds only the request-ID and pending cookie headers,
preserving direct-content status, body, length, and CSP isolation.
Authentication preserves the logical session but atomically rotates its
credential. Generic browser start/callback routes use the provider-neutral
orchestrator, bounded query values, one-use state, validated local returns,
no-store responses, and diagnostics that omit callback values and raw provider
causes. Successful callback rotation is published by the central request
boundary so it supersedes a concurrently staged renewal cookie. Authentication
also issues a 256-bit synchronizer token outside the cookie. Bounded form-only
`POST /auth/logout` validates that token against the current repository record,
atomically revokes the authenticated bearer, and centrally publishes a distinct
fresh guest session and credential; stale, cross-session, and replayed requests
cannot revoke authenticated access. The pinned gauth 0.4.1 Google adapter keeps
its PKCE verifier server-side, maps only verified identity fields, discards
provider tokens, and prevents raw provider failures from crossing the strategy
boundary. Explicit preset composition and provider registration remain, so
Google routes still resolve as unknown. The current in-memory repository is
process-local and invalidates sessions on restart. See
[session-and-authentication.md](session-and-authentication.md).

The `auth` namespace is reserved alongside `site` and `api`, so authentication
routes cannot collide with direct page locators.

## QT-API — API behavior

- Direct content delivery and publishing use documented HTTP behavior.
- Site and programmatic publishing apply the same locator, content, access, and
  limit rules.
- Errors should be useful to both a browser and a programmatic client.
- The selected HTTP mapping must keep API endpoints and direct page locators
  unambiguous.

Random namespace and page-name suggestions are presentation-only and do not
change locator rules or query server availability. Their quiet actions belong to
the input header rather than competing with the locator fields as standalone
buttons. The current overwriteable guest flow has no locator availability
endpoint, so numeric fallback only avoids a combination already generated in the
local UI.

The current guest API is `POST /api/pages` with an `application/json` body:
`namespace` and `md` are required strings; `page_name` and `css` are optional
strings. Success returns `201`, a relative `Location` header, and JSON
containing `path` and absolute `url`. Malformed requests return `400`, oversized
request bodies `413`, unsupported media types `415`, reserved namespaces `403`,
and locator or content validation failures `422`. Responses use `no-store`.

## QT-SEARCH — Search and privacy

- Private pages and their content must not appear in public search.
- Guest pages must not appear in public search or browsing; they are reachable
  only by their direct URL for raw preview.
- A change from public to private must remove the page from exploration within a
  stated practical delay.
- Content indexing applies only to supported textual representations.

## QT-VERIFY — Verification

Tests should cover the behavior that defines the product:

- default and named page publishing and resolution;
- public direct delivery and private denial;
- protected namespace ownership and conflict rejection;
- limited, overwriteable publishing in an unreserved namespace;
- content-type and display or download behavior;
- publishing limits and capacity behavior;
- route conflicts and missing-page responses;
- page updates without mixed content and metadata;
- exclusion of private and guest pages from exploration.
