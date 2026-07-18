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

A page is an endpoint associated with content. URLs and content are related but
separate aspects of that endpoint.

### Page URL

A page locator contains a namespace and optionally a page name. A namespace by
itself can locate a default page.

An authenticated creator reserves a namespace and controls its pages. A guest
can use the same locator model without reserving the namespace or receiving an
ownership guarantee.

### Page content

Content can have different formats. It may be HTML, text, a PDF, an image, or
another supported type. Depending on the format, a direct URL may display the
content or download it.

## Current implementation

The first publishing slice currently provides:

- a path locator where the first segment is the namespace and the remaining
  segments are the optional page name; `site`, `api`, and `auth` are reserved;
- an interface-first, process-local session lifecycle with guest/authenticated
  state, hashed bearer lookup, bounded renewal, atomic credential rotation, and
  revocation; root application middleware now gives every routed request a
  server-generated request ID and typed session, using an opaque host-only
  cookie without changing direct-content response bodies or isolation headers;
- provider-neutral authentication contracts, an interface-backed process-local
  identity repository keyed by stable `(strategy_id, provider_subject)`, and a
  multi-strategy registry that rejects duplicate IDs; bounded, expiring OAuth
  attempts are owned by guest sessions with hashed one-use state, while the
  route-independent authentication service selects strategies, saves identity,
  upgrades the logical session, rotates its bearer credential, and issues a
  256-bit synchronizer token to trusted application UI; generic browser
  start/callback routes provide bounded query handling, browser-safe failures,
  no-store redirects, secret-free diagnostics, and centralized publication of
  the rotated session cookie; bounded form-only `POST /auth/logout` validates
  its CSRF token against repository state, atomically revokes authenticated
  access, and publishes a distinct fresh guest session and bearer; the pinned
  gauth 0.4.1 Google adapter maps exact authorization inputs, server-only PKCE
  context, and verified profile output without retaining provider tokens or
  exposing provider failures; startup configuration explicitly selects and
  composes the package's loopback-only local or original preset and registers
  Google; local mode also serves gauth's package-rendered mock consent screen
  behind exact authorization-query validation, while original mode keeps that
  route unavailable; a server-owned site-navigation presenter maps the typed
  session to either Google sign-in with a validated local return or a
  CSRF-protected logout form, and components render that complete model without
  receiving session IDs or making authorization decisions;
- `MdPage` content, derived from sanitized Markdown with optional CSS;
- in-memory create-or-replace storage (content is lost when the process stops);
- the site shell and mobile-first guest publishing form at `/` and `/site/*`,
  with soft in-field four-word random locator helpers, a collapsible Page
  workspace with exclusive Markdown/CSS source panes, split or full-width
  preview layouts, fullscreen preview, raw and guided Markdown section editing,
  fenced code-block sections, grip-driven section ordering and value merging,
  CSS-reactive sandboxed section previews, editable element-based CSS presets,
  CDN-backed CSS syntax highlighting, and a sandboxed live Markdown/CSS preview;
  `site` and `api` remain reserved as namespaces;
- `POST /api/pages` for JSON guest publishing, returning the direct path and
  URL;
- raw delivery at every other valid locator, with explicit status, media type,
  length, cache, disposition, and active-content isolation headers;
- prototype limits of 96 KiB per guest API request, 64 KiB of Markdown, and 16
  KiB of CSS (all content limits are measured as UTF-8 bytes).

Guest pages, sessions, users, and external identities are currently
process-local. Guest pages remain replaceable by anyone. Total page capacity,
publishing frequency, expiry, namespace reservation, and durable/shared storage
are not implemented; this endpoint is not ready for untrusted public traffic.

## Local development

Run `deno task dev`, open `http://localhost:5173`, draft Markdown and CSS with
the live preview, publish the page, and use the resulting link to open its
direct URL. The development task explicitly sets
`IAM_PAGER_SESSION_COOKIE_MODE=local`, selecting the non-secure
`iam_pager_session_local` cookie for localhost. It also explicitly selects the
local gauth preset with the localhost Google callback and mock-consent URLs.

The site's `Sign in with Google` header action starts the complete development
flow, and the package-rendered consent screen returns through the callback to
the current local site URL with an upgraded browser session. An authenticated
header shows only signed-in state and the CSRF-protected `Sign out` action;
authenticated publishing and management are not implemented yet.

Every other entry point defaults to the production `__Host-iam_pager_session`
cookie with `Secure`; do not set either local mode in a deployed environment.
Original Google authentication requires `IAM_PAGER_GOOGLE_AUTH_MODE=original`,
`IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI`, `IAM_PAGER_GOOGLE_AUTH_CLIENT_ID`, and
`IAM_PAGER_GOOGLE_AUTH_CLIENT_SECRET`; configuration is validated before the
shared application services are created. Static/framework assets served before
Fresh application routing intentionally receive neither session state nor a
request ID. Markdown can be edited as raw source or as guided sections; both
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

## Technical stack

- TypeScript with strict checks
- Deno as the JavaScript runtime
- Deno Fresh as the web framework
- Prism 1.29 from jsDelivr for CSS editor highlighting
