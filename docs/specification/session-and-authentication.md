# Session and authentication foundation

## Current implementation boundary

Phase 1 implements the session lifecycle and its HTTP request boundary while
keeping the logic independent from Fresh routes:

- `SessionService` resolves a bearer credential to exactly one discriminated
  `guest` or `authenticated` session;
- `SessionRepository` owns atomic creation, bounded renewal, credential rotation
  during upgrade, and revocation;
- `MemorySessionRepository` is the first implementation;
- clock, logical-ID, request-ID, and credential generation are injectable
  interfaces; production generators use UUID IDs and 256-bit random base64url
  credentials;
- `CookieSessionStrategy` is the first `SessionTransport`, independent from
  storage and containing only the opaque bearer;
- `RequestContextMiddleware` resolves the session and populates typed
  `AppRequestContext` before a Fresh route runs;
- `IdentityRepository` atomically finds or creates users and external identities
  by `(strategy_id, provider_subject)`, with `MemoryIdentityRepository` as the
  first implementation;
- `AuthenticationStrategy` provides provider-neutral begin/complete operations,
  while `AuthenticationStrategyResolver` keeps orchestration independent from
  the default `AuthenticationStrategyRegistry` implementation.

## Security and lifecycle invariants

The browser credential and logical session ID are different values. Only a
SHA-256 lookup hash of the bearer credential is persisted. Authentication keeps
the logical session ID so earlier guest activity remains attributable, but it
atomically changes the credential and session version; the previous bearer can
no longer resolve the upgraded session. Concurrent or expired upgrades fail as
stale instead of rotating a newer session.

Missing, malformed, unknown, expired, and revoked credentials all resolve by
creating a new guest session. They never select caller-provided identity. A
renewal threshold limits repository and future cookie writes rather than
updating on every request.

Default lifetimes are:

- guest absolute lifetime: 7 days;
- authenticated idle lifetime: 30 days;
- authenticated absolute lifetime: 90 days;
- renewal threshold: 1 day.

These values are centralized in `default_session_config` and can be replaced
explicitly at composition time.

## Cookie and request boundary

Production defaults to the host-only `__Host-iam_pager_session` cookie with
`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, an explicit expiry, and no
`Domain`. Localhost must be selected explicitly with
`IAM_PAGER_SESSION_COOKIE_MODE=local`; apart from using the distinct
`iam_pager_session_local` name, it omits only `Secure`. Invalid mode values fail
at composition time rather than weakening the production cookie. The
`deno task dev` command makes this local selection explicitly.

Every request reaching application file routing receives a new server-owned
request ID in `AppRequestContext` and `x-request-id`, regardless of any inbound
header. Missing or unusable cookies receive a new guest session and replacement
cookie; a valid credential resolves the same logical session, and bounded
renewal refreshes the existing bearer cookie only at the lifecycle threshold.
Static and framework assets handled before file routing are outside this
semantic boundary.

The middleware calls the selected route once and changes only response headers.
Success, redirect, returned or framework-generated error, API, missing-page, and
direct-content responses retain their status, status text, body stream, declared
`Content-Length`, existing cookies, disposition, and CSP/isolation headers.
Session IDs are never exposed as response headers or cookie contents.

## Identity and strategy boundary

External identity uniqueness is the exact `(strategy_id, provider_subject)`
pair. Email, display name, and picture URL are mutable profile attributes: a
later verified observation may update them, but equal email never links users
across strategies. Older concurrent observations cannot roll newer profile data
back. Strategy IDs are lowercase route-safe identifiers, duplicate registration
fails at composition time, and an unknown ID resolves to no strategy so the HTTP
adapter can return `404` without provider conditionals.

The strategy contract accepts application-owned state and returns an opaque
attempt context that must remain server-side. The composition root currently
registers no provider adapter; Google is added only after attempt orchestration
exists.

## Storage limitation

`MemorySessionRepository` and `MemoryIdentityRepository` are process-local.
Restarting the process invalidates all sessions and loses users/identities, and
multiple app instances do not share either state. They are not production
durability or horizontal-scaling solutions. Repository interfaces are the
replacement boundaries; cookie transport remains independent from session
storage.

## Next boundary

Phase 2 continues with bounded OAuth-attempt ownership and replay protection,
the authentication service, generic start/callback routes, safe local returns,
session upgrade/credential rotation, and CSRF-protected logout. Google/gauth
adaptation remains phase 3; header and authenticated navigation work stays gated
behind the complete authentication core.
