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

The current prototype maps `/` and `/site/*` to the site, reserves `site` and
`api` as namespaces, and maps every other unclaimed path through the path-slug
locator strategy. Replaceable guest content uses `no-store` until validators
exist. Active HTML and SVG delivery must receive an origin-less sandbox and a
restrictive content security policy in addition to content sanitization.

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
locally inside a sandboxed iframe, without a preview HTTP request. Markdown has
switchable raw and guided physical-line editors backed by the same source
string. The guided editor must losslessly derive lines from untouched source; it
may recognize safe common forms but must retain unfamiliar Markdown as raw
editable lines instead of approximating a full Markdown parser. Collapsed lines
are content-only previews; activating one toggles its focused controls and
closes the previously active line, with unsaved changes guarded. Focused forms
support value-preserving type changes and field-level Paste, Copy, and Clear
actions. Paste must fall back to explicit manual entry when browser clipboard
reads are unavailable or denied. Structured editing is presentation logic only
and does not replace the publish input or server content handler. This draft
representation is intentionally simple; authoritative validation and
sanitization remain in the server-side content handler at publish time, keeping
Deno/server dependencies out of the browser module graph. CSS presets contain
element-oriented starting styles and replace the editable CSS draft when
selected.

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

## QT-API — API behavior

- Direct content delivery and publishing use documented HTTP behavior.
- Site and programmatic publishing apply the same locator, content, access, and
  limit rules.
- Errors should be useful to both a browser and a programmatic client.
- The selected HTTP mapping must keep API endpoints and direct page locators
  unambiguous.

Random namespace and page-name suggestions are presentation-only and do not
change locator rules or query server availability. The current overwriteable
guest flow has no locator availability endpoint, so numeric fallback only avoids
a combination already generated in the local UI.

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
