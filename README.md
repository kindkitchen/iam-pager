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
- one current immutable content asset, with authoritative metadata kept locally;
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
namespaces. External delivery failures are visible and filterable in page
management; creators can re-link a byte-identical external copy or replace the
content inline to detach it. Publishing and reference editing select from the
creator's owned namespaces, including cross-namespace aliases; a newly reserved
namespace is available to the publishing selector immediately. Every managed
mutation is owner-checked and revision-bound.

Signed-in creators manage connected storage at `/site/manage`: connect or
reauthorize Google Drive, inspect owner-safe account/scope/status metadata,
disconnect with a dependent-page warning, and choose an active write-capable
provider when publishing or replacing Markdown/PDF content. Requested external
writes validate and upload before the page commit and never fall back inline.

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

Generic binary publication, text indexing, quotas, publishing rate limits, guest
expiry, and account deletion are outside the current boundary. External content
storage now has its provider-neutral contract, registry, in-memory reference
adapter, payload-free external assets, encrypted creator connections, separate
Google Drive OAuth flow, and production Drive REST provider. Eligible direct and
site-wrapper delivery fetches complete bounded provider bytes, verifies local
size and SHA-256 facts, and serves them through iam-pager without redirecting.
Missing, revoked, altered, or temporarily unreachable sources return the same
platform-owned `503` placeholder; definitive failures are recorded idempotently
on the page and verified recovery clears that revision-neutral health state.
Management summaries expose the safe cause and detection time to owners, the web
shows warning/repair controls, and a revision-bound repair either re-links a
verified byte-identical file or replaces content inline. Creator-facing external
publishing and storage settings are available on the site and through the
browser-owned storage-connections API.

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
- `lib/external-storage/` defines bounded provider operations, normalized
  missing/unreachable outcomes, a read-only resolver registry, and reusable
  provider conformance tests. `ContentAsset` discriminates inline data from an
  external reference with local integrity facts; Deno KV stores no payload
  object for external assets and decodes legacy source-less manifests as inline.
  Page logic consumes this contract and never provider SDKs or OAuth details
  directly. `StorageConnectionRepository` separately owns one live connection
  per creator/provider pair, retained revocation metadata, and provider-only
  credentials; memory and Deno KV share conformance, and the KV adapter stores
  only connection-bound AES-256-GCM ciphertext under credential keys. The
  production Google Drive adapter uses a bounded HTTP gateway, records Drive's
  `md5Checksum` as the opaque version hint, refreshes tokens single-flight, and
  revokes invalid connections; local tests use an in-process fake Drive server.
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
[the external-storage contract](docs/specification/external-storage.md),
[the page API contract](docs/api/pages.md),
[the API authentication reference](docs/api/authentication.md),
[the storage-connections contract](docs/api/storage-connections.md), and
[the API-key contract](docs/api/api-keys.md).

## Local development

The repository pins Deno 2.5.0.

```sh
deno task dev
```

Open <http://localhost:5173>. The development task selects the localhost session
cookie and gauth's loopback-only mock Google sign-in and Drive-consent flows.
Neither fake mode may be exposed in production.

[`.env.example`](.env.example) is the tracked, credential-free catalog of every
application environment variable, including its runtime context and Deno Deploy
plain-text/secret classification. Copy it to the gitignored
`.env.production.local` before adding real values. See the
[deployment environment guide](docs/deployment-environment.md) for context
setup, Deno Deploy bulk import, and the importer's metadata limitations.

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

Repository factories retain process-memory defaults for tests and direct local
compositions. The configured runtime refuses to start until ownership, session,
and page storage are selected explicitly; `deno task dev` deliberately selects
memory. `DENO_KV_ID` and `DENO_KV_ACCESS_TOKEN` do not select application
repositories.

For one durable Deno KV composition, set:

```env
IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv
IAM_PAGER_SESSION_STORAGE_BACKEND=deno-kv
IAM_PAGER_PAGE_STORAGE_BACKEND=deno-kv
```

Deployments using the former `IAM_PAGER_CONTENT_STORAGE_BACKEND` page selector
remain compatible; new configuration should use
`IAM_PAGER_PAGE_STORAGE_BACKEND`. `IAM_PAGER_API_KEY_STORAGE_BACKEND` can
explicitly override API keys to `memory` or `deno-kv`; normally no override is
needed. API keys and storage connections inherit ownership.

For a self-hosted database, also set the shared path:

```env
IAM_PAGER_OWNERSHIP_DENO_KV_PATH=/var/lib/iam-pager/iam-pager.kv
```

For remote Deno KV outside Deno Deploy, the path must be the connection URL and
the access token must be in the environment; `DENO_KV_ID` is not converted into
a URL automatically:

```env
IAM_PAGER_OWNERSHIP_DENO_KV_PATH=https://api.deno.com/v2/databases/<database-id>/connect
DENO_KV_ACCESS_TOKEN=...
```

On Deno Deploy, leave the path unset to use the attached database. Durable
sessions, pages, and API keys require durable ownership so a session, protected
page, or API key cannot outlive its user and namespace claim. Selecting a
backend or path does not migrate data. Adding or removing a page alias
atomically retains the page's immutable asset; continuity still depends on
selecting Deno KV rather than process memory.

The Deno KV storage-connection adapter requires a canonical unpadded base64url
256-bit token-custody key supplied as `IAM_PAGER_STORAGE_TOKEN_KEY`. Keep the
key outside KV and deployment logs; losing it makes stored provider credentials
unrecoverable. `IAM_PAGER_STORAGE_CONNECTION_BACKEND` may explicitly select
`memory` or `deno-kv`; normally it inherits ownership. One-use Drive OAuth state
uses its own `storage-oauth-attempts/google-drive` KV prefix.

## Authentication configuration

Production uses a secure `__Host-iam_pager_session` cookie and original Google
OAuth mode:

```env
IAM_PAGER_SESSION_COOKIE_MODE=production
IAM_PAGER_GOOGLE_AUTH_MODE=original
IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI=https://example.com/auth/google/callback
IAM_PAGER_GOOGLE_AUTH_CLIENT_ID=...
IAM_PAGER_GOOGLE_AUTH_CLIENT_SECRET=...

# Separate Google Cloud OAuth client; storage consent is not sign-in.
IAM_PAGER_GOOGLE_DRIVE_MODE=original
IAM_PAGER_GOOGLE_DRIVE_REDIRECT_URI=https://example.com/auth/storage/google-drive/callback
IAM_PAGER_GOOGLE_DRIVE_CLIENT_ID=...
IAM_PAGER_GOOGLE_DRIVE_CLIENT_SECRET=...
```

Drive requests `drive.file` as its only content permission, plus the identity
scopes gauth needs to verify the provider account, and forces offline explicit
consent. In `original` mode those same Drive client credentials compose the
`google-drive` external provider; local mode mocks consent only and does not
register a remote-content provider. Connect and callback require an
authenticated browser session; disconnect is POST-only and requires that
session's CSRF token. The routes are
`/auth/storage/google-drive/{start,callback,disconnect}`.

An explicitly designated HTTPS preview can use credential-free local OAuth by
setting both integrations to `local` and allowlisting its full request host:

```env
IAM_PAGER_GOOGLE_AUTH_MODE=local
IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN=iam-pager-pr-[a-z0-9-]+\.example\.com
IAM_PAGER_GOOGLE_DRIVE_MODE=local
IAM_PAGER_GOOGLE_DRIVE_REQUEST_HOST_PATTERN=iam-pager-pr-[a-z0-9-]+\.example\.com
```

In this profile, omit both redirect URIs, mock-consent URLs, client IDs, and
client secrets. Each callback origin comes from the HTTPS request URL only after
a complete host-pattern match; the application retains the fixed callback and
mock-consent paths. `Origin` and `Referer` are never callback authorities. Local
mode grants fake authentication or Drive consent on every matched host, does not
register the remote Drive provider, and must exclude production.

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
and storage selectors. The application requires no Build-context variables; its
configuration belongs to the Production and Development runtime contexts.

After deployment, verify that direct-content, framework-level, and wrapped-page
404 responses are HTML pages with a working home link:

```sh
deno task smoke:not-found https://example.com
```
