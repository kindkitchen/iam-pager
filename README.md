# iam-pager

`iam-pager` publishes content at deterministic namespace-based URLs. Opening a
page URL returns the content itself; the site is a separate projection for
publishing, exploration, wrapped viewing, and creator management.

The platform does not assign meaning to a page or to relationships between
pages. That remains the author's responsibility.

## Product boundary

A locator is a namespace plus an optional page name. A namespace-only locator
addresses its default page. The current path mapping is:

```text
/<namespace>[/<page-name>]
```

`site`, `api`, and `auth` are reserved namespaces. Locator identity is
case-insensitive while publisher casing is preserved.

A logical page has:

- one stable management ID;
- one current immutable content asset;
- one canonical endpoint and up to seven alternate endpoints in one namespace;
- one access policy, revision, tag set, management row, and exploration row.

Each endpoint binds an ordinary locator to an explicit `inline` or `attachment`
profile. Paths and filename suffixes do not imply delivery behavior.

### Visitors and guests

Anyone can:

- open known public content directly, without the site shell;
- inspect it through `/site/<locator>`;
- browse and filter public creator pages by namespace, page name, and exact tag;
- publish a public trial page in an unreserved namespace.

Trial pages are not discoverable. They have no owner guarantee and may be
replaced by another guest or by a creator who reserves the namespace. Missing,
private, invalid, and unauthorized visitor lookups share a non-disclosing 404.

### Creators

Google authentication establishes an application user. A creator can reserve one
or more namespaces and then create, inspect, update, rename, duplicate, make
public or private, tag, filter, bulk-change, and delete pages in those
namespaces. Every managed mutation is owner-checked and revision-bound.

### Content

The current handlers are:

- `md-page`: up to 64 KiB Markdown plus 16 KiB optional CSS, sanitized at
  publication, inline delivery only;
- `pdf`: up to 16 MiB, fixed `application/pdf`, portable filename metadata,
  lightweight PDF structure validation, and inline or attachment delivery.

PDF create and replacement use strict bounded multipart requests. One asset can
serve browser-preview and download endpoints with byte-identical content. Direct
PDF delivery supports validators and one byte range.

External storage, generic binary publication, text indexing, quotas, publishing
rate limits, guest expiry, and account deletion are outside the current
boundary.

## Architecture

Product logic lives under `lib/` and does not depend on Fresh routes or UI
components. The web layer only maps requests and presentation models onto those
capabilities.

Important boundaries:

- `LocatorEngine` validates and formats transport-independent locators.
- `PageService` owns publishing, authority, content handling, management,
  delivery, and public-query behavior.
- `PageAggregateRepository` is the persistence interface for immutable assets,
  logical pages, endpoint claims, and owner/public projections.
- `NamespaceRepository`, `IdentityRepository`, and `SessionRepository` isolate
  their corresponding persistence concerns.
- presenters under `lib/ui/` derive complete view models; components do not make
  authorization decisions.
- HTTP adapters under `lib/` own request bounds, strict schemas, CSRF, ETags,
  status mapping, and response headers; Fresh routes stay thin.

Memory and Deno KV implement the same repository interfaces and share
implementation-neutral conformance suites. Deno KV rejects malformed records.
Page visibility changes commit the page, all endpoint claims, and owner/public
projections atomically. Content is staged and verified before any page can
reference it.

See [the project specification](docs/specification/README.md) and
[the page API contract](docs/api/pages.md).

## Local development

The repository pins Deno 2.5.0.

```sh
deno task dev
```

Open <http://localhost:5173>. The development task selects the localhost session
cookie and gauth's loopback-only mock Google flow. Its fake sign-in mode must
never be exposed as production authentication.

Useful commands:

```sh
deno task check   # format, lint, and type-check
deno task test    # all lib tests
deno task verify  # check + test
deno task build   # production Fresh build
```

Install the tracked pre-push verification hook once per clone:

```sh
deno task hooks:install
```

## Persistence

All repositories default to process memory. For one durable Deno KV composition,
set:

```env
IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv
IAM_PAGER_SESSION_STORAGE_BACKEND=deno-kv
IAM_PAGER_PAGE_STORAGE_BACKEND=deno-kv
```

For a self-hosted database, also set the shared path:

```env
IAM_PAGER_OWNERSHIP_DENO_KV_PATH=/var/lib/iam-pager/iam-pager.kv
```

On Deno Deploy, leave the path unset to use the attached database. Durable
sessions and pages require durable ownership so a session or protected page
cannot outlive its user and namespace claim.

## Authentication configuration

Production uses a secure `__Host-iam_pager_session` cookie and original Google
OAuth mode:

```env
IAM_PAGER_SESSION_COOKIE_MODE=production
IAM_PAGER_GOOGLE_AUTH_MODE=original
IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI=https://example.com/auth/google/callback
IAM_PAGER_GOOGLE_AUTH_CLIENT_ID=...
IAM_PAGER_GOOGLE_AUTH_CLIENT_SECRET=...
```

An explicitly designated HTTPS preview may derive callbacks from a narrow,
full-host regular expression:

```env
IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN=iam-pager-pr-[a-z0-9-]+\.example\.com
```

The request URL must match completely. `Origin` and `Referer` are never callback
authorities. Local mode with a host pattern grants fake authentication on every
matched host and must exclude production.

## Build and run

```sh
deno task build
deno task --env-file=.env.production.local start
```

`PORT` is optional and must be an integer from 0 through 65535. Deno Deploy uses
`deno task build` and `_fresh/server.js` with the same production environment
and storage selectors.
