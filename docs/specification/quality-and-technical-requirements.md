# Quality and technical requirements

## QT-STACK — Stack

- strict TypeScript on Deno 2.5.0;
- Fresh, Preact, and Vite for the web projection;
- mobile-first site UI;
- Deno import map and standard packages where practical;
- `deno task check` as the minimum repository gate.

## QT-BOUNDARIES — Architecture

Stable product behavior must not depend on replaceable integrations:

- locators are namespace/page-name values, not paths;
- site and API publishing share `PageService`;
- content handlers do not know HTTP or storage;
- page, immutable asset, and endpoint set are separate models;
- endpoint locators/profiles are publisher intent, never inferred from content;
- identity, namespace authority, sessions, and page persistence use interfaces;
- presenters derive view models before components render them;
- Fresh routes contain no business or authorization logic.

An implementation that satisfies a current interface is valid even when one
composition does not select it. An implementation with no current interface or
product requirement should be removed rather than preserved as a historical
option.

## QT-PAGES — Page consistency

`PageAggregateRepository` is the only page persistence contract. A conforming
implementation must provide:

- case-insensitive endpoint and page identity;
- immutable, boundary-cloned assets;
- all-or-none page and endpoint claims;
- exact-revision managed mutation;
- non-disclosing owner checks;
- coherent owner/public projections;
- one logical row regardless of endpoint count;
- deterministic cursor pagination;
- safe trial takeover and concurrent winner behavior.

The memory implementation is the reference. Deno KV stores a strict page
envelope, endpoint claims, owner/public projections, and manifest-backed
content. Every page visibility mutation uses one native atomic commit. Binary
payloads are staged through the project-owned `KvGateway`, reconstructed and
verified before manifest publication, and reverified on read by length, SHA-256,
codec, and domain invariants.

The maximum eight-endpoint takeover/duplication shape must remain within Deno
KV's atomic-check limit. Commit exceptions are treated as ambiguous; code must
not delete potentially referenced bytes or replay non-idempotent page changes.

## QT-STORAGE — Storage selection

Identity plus namespace ownership form one persistence unit. Sessions and pages
are separate opt-ins but durable selection requires durable ownership, so an
authenticated session or protected page cannot outlive its user and claim.

Each repository defaults to memory. Current durable selectors are:

```env
IAM_PAGER_OWNERSHIP_STORAGE_BACKEND=deno-kv
IAM_PAGER_SESSION_STORAGE_BACKEND=deno-kv
IAM_PAGER_PAGE_STORAGE_BACKEND=deno-kv
```

All Deno KV adapters use the ownership database path or attached default
database. Changing backend or path does not copy data. Record decoders reject
unknown, malformed, or incoherent storage values.

## QT-ROUTING — HTTP routing and delivery

- `site`, `api`, and `auth` cannot be published as namespaces.
- Missing direct pages must not return the successful home page.
- Direct responses set intentional status, type, length, cache, disposition,
  validators, and isolation headers.
- Private and unauthorized pages are ordinary missing to visitors.
- The stored endpoint profile alone selects inline versus attachment behavior.
- Active creator content cannot read or mutate authenticated platform state.
- Content and metadata changes must become visible together.

PDF delivery supports bounded full responses, matching `If-None-Match`, and one
strict byte range with `If-Range`, `206`, or bodyless `416`. Multiple or
malformed ranges are rejected.

## QT-CONTENT — Content handling

Accepted formats and limits are explicit. Filenames never establish media type.
Handlers detach mutable binary input and expose bounded management metadata
without payload bytes.

Markdown limits are 64 KiB source and 16 KiB optional CSS. Publishing derives
sanitized HTML. Creator CSS is escaped against style-tag breakout. Direct active
content receives restrictive isolation; wrapped HTML uses a sandboxed,
no-referrer frame.

PDF is limited to 16 MiB and a 255-byte portable UTF-8 filename. Its structure
screen is not malware certification. PDF create/replacement uses one strict
metadata part and one PDF part under a 16 MiB plus 64 KiB request bound. Generic
binary content is not implied.

## QT-AUTHORITY — Security

- Browser identity comes only from the resolved server session.
- Namespace ownership is resolved server-side for every mutation.
- Authenticated mutations require the session synchronizer token.
- Managed page changes require exact strong revision ETags at HTTP boundaries.
- OAuth state and bearer credentials are generated with 256 bits of entropy;
  persistence stores only hashes.
- Authentication rotates the bearer; logout revokes it and creates an unrelated
  guest session.
- Callback URLs come from validated configuration or a full HTTPS request-host
  match, never `Origin` or `Referer`.
- Provider tokens, raw callback values, cookies, and provider failures never
  enter diagnostics or presentation models.

See [session-and-authentication.md](session-and-authentication.md).

## QT-API — API behavior

Request objects are strict and bounded. Unknown fields, duplicate query fields,
unsupported media, malformed JSON/multipart, and oversized input fail before
mutation. Owner IDs are never accepted or returned.

Authenticated create/update/delete/action requests use browser session identity,
CSRF, and exact revisions. List cursors are opaque and bound to normalized
filter scope. Management lists omit editable content; inspection returns only
handler-approved input. Errors expose stable codes and bounded safe detail.

The exact contract is in [the page API reference](../api/pages.md).

## QT-SEARCH — Privacy

Public queries operate on current page state and exclude private and trial pages
inside repository capabilities. Namespace/page-name matching is lowercase
substring matching; tags are exact canonical values; supplied filters use AND
semantics. Public-to-private changes disappear from the next query.

## QT-UI — Presentation

UI helpers may suggest random locators, edit Markdown as raw text or guided
sections, preview drafts, and prepare multipart requests. They are advisory and
must not replace server validation.

The structured Markdown editor preserves one source string, retains unfamiliar
Markdown losslessly, groups fenced code blocks, and keeps transformation logic
in raw browser-safe modules. Components render complete models and do not infer
authority, endpoint profiles, or API success.

## QT-VERIFY — Regression boundary

Tests should protect current behavior, not removed release transitions. Shared
conformance must run against memory and Deno KV implementations. Coverage must
include:

- default/named locators and route collisions;
- trial replacement and namespace protection;
- public/private direct delivery and wrapped views;
- page revision, endpoint-set, asset, tag, duplicate, bulk, and delete behavior;
- concurrent winner and corruption failure paths;
- strict JSON/multipart, CSRF, ETag, and range handling;
- public-query privacy and cursor isolation;
- identical PDF bytes under endpoint-specific disposition;
- presenter/component boundaries that keep logic outside the web layer.
