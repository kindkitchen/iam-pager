---
name: api-keys
description: API-key lifecycle, bearer principals, and per-endpoint permissions. Load when touching /api authentication, authorization, or key management.
updated: 2026-07-29
sources: [api-keys]
---

An API key is not a browser session. It has its own ID, secret hash, label,
permissions, expiry, revision, and revocation lifecycle — no logical session,
OAuth attempt, idle renewal, cookie, or CSRF token. Nothing synthesizes a
`Session` from a key.

## Code map

- `lib/api-key/` — model, `ApiKeyService`, ETags, `MemoryApiKeyRepository`,
  `DenoKvApiKeyRepository`, one shared `repository-conformance.ts`,
  `ApiKeyHttpAdapter`.
- `lib/api-auth/` — `ApiPrincipal` (guest / browser_user / api_key),
  `BearerFirstApiRequestAuthenticator`, `PermissionApiOperationPolicy`.
- `lib/ui/api-key-panel.ts` + `islands/ApiKeyPanel.tsx` + `/site/api-keys` —
  optional projection over the API; removing it removes no capability.
- Contracts: `docs/api/authentication.md`, `docs/api/api-keys.md`; matrix test
  `lib/api-contract-matrix.test.ts`.

## Rules in force

- Transport is `Authorization: Bearer <key>` on `/api/**` only — never query,
  body, cookie, site/direct-content routes, or `/auth/**`. A present
  `Authorization` header is authoritative: malformed, unknown, expired, or
  revoked keys get one non-disclosing `401` with a Bearer challenge and never
  fall back to the cookie. A bearer request skips cookie-session resolution
  entirely and receives an ephemeral guest view, so no session or cookie is ever
  issued for it.
- Permissions are explicit `read`, `write`, `delete`. `all` is input shorthand
  that expands to the current set on store and read, so future permissions are
  never silently granted. Mapping: `read` = page/namespace reads, `write` =
  reserve, create, update, rename, duplicate, access mutations, `delete` = page
  delete/bulk delete and API-key revoke-all. Domain owner, namespace, and
  revision checks still apply after the permission check.
- Key management (list, create, inspect, update, individual delete) requires an
  authenticated browser session plus CSRF plus strong `If-Match`, regardless of
  key permissions. Collection `DELETE /api/api-keys` is the only bearer-accessible
  key operation, requires `delete`, is bodyless, and revokes the calling key.
- Secrets: ≥256 random bits, `iamp_` prefix, returned once on create, persisted
  only as a SHA-256 lookup hash. Rotation is create-new then delete-old. No
  `last_used_at` write on authenticated requests.
- Metadata: opaque ID, bounded non-empty label (duplicates allowed), sorted
  explicit permissions, `expires_at` future timestamp or `null`, timestamps,
  revision, status. Expired keys stay browser-manageable but cannot authenticate.
- Deno KV revoke-all is a single owner-generation bump: one linearizable commit
  invalidating unbounded key counts; dead entries purge lazily so identifiers
  stay reusable.
- A page with `block_api_write` set refuses every key-authenticated mutation with
  `403` `api_write_blocked` after the permission check, and the flag itself is
  never settable from a key (`403` `protection_requires_session`). See
  `specs/agent-automation/SKILL.md`.
- Key authentication never enables guest behavior — a key-authenticated create is
  always a managed create, and keys do not reach private direct-content delivery.
