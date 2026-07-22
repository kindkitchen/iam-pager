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

- one stable management ID, independent of every locator;
- one current immutable content asset;
- a non-empty set of locator references, one preferred only for stable
  management and exploration links;
- one access policy, revision, tag set, management row, and exploration row.

Any number of valid URLs may reference the same logical content. Each reference
binds an ordinary locator to an explicit delivery profile supported by the
content format. The current profiles are `inline` and `attachment`; paths,
preferred status, and filename suffixes do not imply delivery behavior. Managed
references may cross namespaces when the same creator owns all of them.

### Visitors and guests

Anyone can:

- open known public content directly, without the site shell;
- inspect it through `/site/<locator>`;
- browse and filter public creator pages at `/site/explore` by namespace, page
  name, and exact tag;
- publish a public trial page when every referenced namespace is unreserved.

Trial pages are not discoverable. They have no owner guarantee and may be
replaced by another guest or by a creator who reserves the namespace. Missing,
private, invalid, and unauthorized visitor lookups share a non-disclosing 404.

### Creators

Google authentication establishes an application user. A creator can reserve one
or more namespaces and then create, inspect, update, rename, duplicate, make
public or private, tag, filter, bulk-change, and delete pages in those
namespaces. Publishing and reference editing select from the creator's owned
namespaces, including cross-namespace aliases; a newly reserved namespace is
available to the publishing selector immediately. Every managed mutation is
owner-checked and revision-bound.

Signed-in creators also manage their API keys at `/site/api-keys`: generate a
key with a typed or shared four-word random label, explicit permissions, and
optional expiry; copy the one-time bearer; edit or revoke individual keys; and
revoke everything at once. The page is a projection of the same API-key
capabilities exposed at `/api/api-keys`.

### Content

The current handlers are:

- `md-page`: up to 64 KiB Markdown plus 16 KiB optional CSS, sanitized at
  publication, inline delivery only;
- `pdf`: up to 16 MiB, fixed `application/pdf`, portable filename metadata,
  lightweight PDF structure validation, and inline or attachment delivery.

PDF create and replacement use strict bounded multipart requests. PDF has no
special locator-count or profile-combination rule: one locator is sufficient,
and optional aliases may expose byte-identical content. In the web UI each PDF
path has a `Downloadable` checkbox: unchecked is inline delivery and checked is
attachment delivery. Add an alias only when separate inline and download URLs
are wanted. Content-only replacement preserves all references. Direct PDF
delivery supports validators and one byte range.

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
- `ApiKeyManager` and `ApiKeyRepository` own the owner API-key lifecycle:
  browser-authenticated owners manage scoped, optionally expiring keys, bearers
  are returned once and stored only as hashes, and bearer-authenticated
  revoke-all is the single key operation an API key may perform on itself.
- `ApiRequestAuthenticator` and `ApiOperationPolicy` resolve every `/api/**`
  request to a guest, browser-user, or API-key principal. A presented
  `Authorization: Bearer` header is authoritative (no cookie fallback and no
  cookie issued for bearer requests); key requests skip CSRF and instead need
  the mapped `read`/`write`/`delete` permission, with domain ownership rules
  unchanged.
- presenters under `lib/ui/` derive complete view models; components do not make
  authorization decisions.
- HTTP adapters under `lib/` own request bounds, strict schemas, CSRF, ETags,
  status mapping, and response headers; Fresh routes stay thin.

Memory and Deno KV implement the same repository interfaces and share
implementation-neutral conformance suites. Deno KV rejects malformed records.
Page visibility changes commit the page, all endpoint claims, and owner/public
projections atomically. Content is staged and verified before any page can
reference it. Endpoint count is not a domain rule; the current Deno KV adapter
reports a capacity error above eight references because of its native atomic
check budget, while the memory implementation accepts larger request-bounded
sets.

See [the project specification](docs/specification/README.md),
[the page API contract](docs/api/pages.md),
[the API authentication reference](docs/api/authentication.md), and
[the API-key contract](docs/api/api-keys.md).

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

Ownership, sessions, and pages default to process memory. API keys inherit the
ownership backend by default, preventing durable creator identities from getting
process-local keys. For one durable Deno KV composition, set:

```env
IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv
IAM_PAGER_SESSION_STORAGE_BACKEND=deno-kv
IAM_PAGER_PAGE_STORAGE_BACKEND=deno-kv
```

`IAM_PAGER_API_KEY_STORAGE_BACKEND` can explicitly override API keys to `memory`
or `deno-kv`; normally no override is needed.

For a self-hosted database, also set the shared path:

```env
IAM_PAGER_OWNERSHIP_DENO_KV_PATH=/var/lib/iam-pager/iam-pager.kv
```

On Deno Deploy, leave the path unset to use the attached database. Durable
sessions, pages, and API keys require durable ownership so a session, protected
page, or API key cannot outlive its user and namespace claim.

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

## API keys

Signed-in creators generate API keys at `/site/api-keys` (or via
`POST /api/api-keys` from an authenticated browser session). The `iamp_...`
bearer is shown exactly once; only its hash is stored and it cannot be recovered
— rotation is create-new then delete-old.

A key authenticates `/api/**` requests through the `Authorization` header:

```sh
curl -H "Authorization: Bearer iamp_..." https://example.com/api/pages

curl -X POST https://example.com/api/pages \
  -H "Authorization: Bearer iamp_..." \
  -H "content-type: application/json" \
  -d '{"locator":{"namespace":"Robot","page_name":"status"},
       "access":"public",
       "content":{"content_type":"md-page","input":{"md":"# Up"}}}'
```

Permissions are explicit `read`, `write`, and `delete` grants (`all` expands to
the current explicit set at creation). Key requests carry no CSRF token; each
operation requires its mapped permission, and domain rules — namespace
ownership, revision `If-Match`, request bounds — are unchanged. Keys never
authenticate site routes, `/auth/**`, or direct-content URLs, and key management
itself stays browser-owned except bearer revoke-all (`DELETE /api/api-keys` with
the `delete` grant, which also revokes the calling key). The full matrix is in
[the API authentication reference](docs/api/authentication.md).

**Security:** treat a bearer like a password. Send it only in the
`Authorization` header over HTTPS — never in URLs, query strings, request
bodies, cookies, or logs. Grant the narrowest permissions, set an expiry where
practical, and revoke immediately on suspicion; an explicit invalid bearer is
rejected without any cookie fallback.

## Build and run

```sh
deno task build
deno task --env-file=.env.production.local start
```

`PORT` is optional and must be an integer from 0 through 65535. Deno Deploy uses
`deno task build` and `_fresh/server.js` with the same production environment
and storage selectors.

After deployment, verify that direct-content, framework-level, and wrapped-page
404 responses are HTML pages with a working home link:

```sh
deno task smoke:not-found https://example.com
```
