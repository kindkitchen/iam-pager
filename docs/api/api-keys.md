# API-key API

API keys are owner credentials for the `/api/**` automation surface. They are
not browser sessions: a key has no cookie, CSRF token, OAuth attempt, or idle
renewal, and it never authenticates site or direct-content routes.

All responses use `Cache-Control: no-store`. JSON errors share the platform
shape:

```json
{ "ok": false, "error": "stable_code", "detail": "bounded safe detail" }
```

## Bearer representation

A bearer is `iamp_` plus 43 base64url characters (256 random bits). It is
returned exactly once, in a successful create response, and is unrecoverable
afterwards: only a SHA-256 lookup hash is stored. Rotation is create-new then
delete-old.

Bearers ride only in `Authorization: Bearer <key>` on `/api/**` requests. Query
strings, bodies, cookies, `/auth/**`, site routes, and direct-content routes
never carry a key. When an `Authorization` header is present it is
authoritative: malformed, unknown, expired, and revoked bearers all produce one
non-disclosing `401` with a `WWW-Authenticate: Bearer` challenge, and a valid
session cookie is never a fallback.

## Permissions

Explicit grants are `read`, `write`, and `delete`. The input shorthand `all`
must appear alone and expands to the complete current explicit set at write
time, so future permissions are never granted silently. Stored and returned
permission lists are always explicit and in canonical `read, write, delete`
order.

Keys authorize the page and namespace operations under `/api/**`
([the API authentication reference](authentication.md) maps each operation to
its required permission). Key management itself stays browser-owned: the sole
key-accessible management operation is bearer revoke-all below.

## Key metadata

```json
{
  "api_key_id": "opaque-id",
  "label": "ci deployment",
  "permissions": ["read", "write", "delete"],
  "status": "active",
  "expires_at": "2027-01-01T00:00:00.000Z",
  "created_at": "2026-07-22T12:00:00.000Z",
  "updated_at": "2026-07-22T12:00:00.000Z",
  "revision": 1
}
```

- `label`: 1–64 characters, no control characters; duplicates are allowed.
- `expires_at`: exact ISO instant in the future, or `null` for no expiry.
- `status`: `active` or `expired`. Expired keys stay browser-manageable but can
  no longer authenticate.
- `revision` starts at 1 and increments on every metadata update. Item
  representations carry the strong validator `"api-key-<id>-r<revision>"` in
  `ETag`.

Metadata never contains the bearer or its hash.

## Management operations (browser session only)

List, create, inspect, update, and individual delete require an authenticated
browser session. An explicit bearer on these operations is rejected with the
non-disclosing `401` regardless of its grants. Mutations require the session
synchronizer token in `x-csrf-token`. Request bodies are strict
`application/json` limited to 4 KiB; unknown fields are rejected.

### `GET /api/api-keys`

Returns `{ "ok": true, "api_keys": [...] }` — every key the caller owns, oldest
first, then ID.

### `POST /api/api-keys`

Body: `{ "label": "...", "permissions": [...], "expires_at": "..."? }`
(`expires_at` may be omitted or `null`).

`201` returns `{ "ok": true, "api_key": { ... }, "bearer": "iamp_..." }` with
the key's `ETag`. This is the only representation that ever contains the bearer.
Validation failures return `422` with `invalid_label`, `invalid_permissions`, or
`invalid_expiry`.

### `GET /api/api-keys/:api_key_id`

`200` with metadata and `ETag`. Foreign and unknown IDs share one non-disclosing
`404 not_found`.

### `PATCH /api/api-keys/:api_key_id`

Full metadata replacement: `label`, `permissions`, and `expires_at` are all
required. A strong `If-Match` for this key is required: missing returns
`428 precondition_required`; mismatched or stale returns
`412 precondition_failed`. `200` returns the updated metadata and new `ETag`.

### `DELETE /api/api-keys/:api_key_id`

Requires `x-csrf-token` and a strong `If-Match`. Revocation is immediate: the
key stops authenticating before the response is sent. `200` returns
`{ "ok": true }`.

## Revoke-all: `DELETE /api/api-keys`

The collection delete is bodyless and atomically revokes every key of one owner.
It is the only key operation reachable with a bearer:

- **Browser**: authenticated session plus `x-csrf-token`.
- **Bearer**: a valid key with the `delete` permission. Revocation includes the
  calling key itself; a valid key without `delete` receives
  `403 insufficient_permission`.

`200` returns `{ "ok": true, "revoked_count": n }`.

## Permission matrix (current scope)

| Operation                           | Browser session       | API key  |
| ----------------------------------- | --------------------- | -------- |
| `GET /api/api-keys`                 | yes                   | never    |
| `POST /api/api-keys`                | yes + CSRF            | never    |
| `GET /api/api-keys/:id`             | yes                   | never    |
| `PATCH /api/api-keys/:id`           | yes + CSRF + If-Match | never    |
| `DELETE /api/api-keys/:id`          | yes + CSRF + If-Match | never    |
| `DELETE /api/api-keys` (revoke-all) | yes + CSRF            | `delete` |

Bearer authorization of the page and namespace APIs (`read`/`write`/`delete`
mapped onto every owner operation) is specified in
[the API authentication reference](authentication.md). Guest trial publication
remains a browser-only capability; API keys have no guest behavior.
