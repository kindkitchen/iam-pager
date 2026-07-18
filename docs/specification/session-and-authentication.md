# Session and authentication foundation

## Current implementation boundary

The implemented foundation covers the session lifecycle, request boundary,
authentication orchestration, and generic browser start/callback adapters while
keeping the logic independent from Fresh routes:

- `SessionService` resolves a bearer credential to exactly one discriminated
  `guest` or `authenticated` session;
- `SessionRepository` owns atomic creation, bounded renewal, credential rotation
  during upgrade, CSRF-bound authenticated logout, and revocation;
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
  the default `AuthenticationStrategyRegistry` implementation;
- `AuthenticationService` owns route-independent start/callback orchestration:
  strategy selection, safe local returns, one-use attempt consumption, verified
  identity persistence, logical-session upgrade, and bearer rotation;
- `AuthenticationHttpAdapter` maps generic browser requests and outcomes without
  depending on Fresh, while thin routes select strategies or publish logout;
- `GoogleGAuthStrategy` is the first provider adapter, pinned to gauth 0.4.1 and
  depending only on its exported interface; validated startup configuration
  explicitly composes the package's selected local or original preset before
  registering Google;
- `GoogleMockConsentHttpAdapter` serves gauth's package-rendered consent screen
  only for the loopback local preset, behind a Fresh-independent interface;
- `RequestContextMiddleware.apply_session_resolution` publishes a route-owned
  rotation centrally, superseding any credential renewal staged at resolution;
- `SiteNavigationPresenter` maps typed server session state to a complete
  presentation model: safe Google sign-in for guests or the fixed CSRF-protected
  logout form for authenticated sessions.

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
- renewal threshold: 1 day;
- authentication-attempt lifetime: 10 minutes;
- pending authentication attempts per guest session: 5.

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
`Content-Length`, existing cookies, disposition, and CSP/isolation headers. A
successful callback stages its upgraded session and rotated credential through
the same middleware boundary; that credential supersedes any renewal selected
when the request began, so conflicting session cookies are not emitted. Session
IDs are never exposed as response headers or cookie contents.

## Identity and strategy boundary

External identity uniqueness is the exact `(strategy_id, provider_subject)`
pair. Email, display name, and picture URL are mutable profile attributes: a
later verified observation may update them, but equal email never links users
across strategies. Older concurrent observations cannot roll newer profile data
back. Strategy IDs are lowercase route-safe identifiers, duplicate registration
fails at composition time, and an unknown ID resolves to no strategy so the HTTP
adapter can return `404` without provider conditionals.

The strategy contract accepts application-owned state and returns an opaque
attempt context that remains server-side. `AuthenticationService` generates 256
bits of state, while session persistence stores only its SHA-256 hash together
with the selected strategy, exact callback URL, validated local return, provider
context, and timestamps. Attempts belong only to the guest session that started
them, expire after 10 minutes, and are capped at five; a sixth start evicts the
oldest live attempt. Mismatched, expired, cross-session, and replayed state
cannot upgrade a session.

Callback handling consumes the matching attempt atomically before provider
exchange. A malformed code or provider failure therefore leaves the session as
guest without retaining reusable state. Success find-or-creates the identity by
stable provider subject, preserves the logical session ID, rotates the bearer so
the old credential stops resolving it, and issues a new 256-bit synchronizer
token. That token is persisted with the authenticated session and exposed only
to trusted application code for state-changing forms; it is not placed in the
cookie or a response header. Caller-provided return paths must start with one
`/`; absolute, protocol-relative, backslash, control-byte, and recursively
encoded external forms are rejected.

The generic browser boundary exposes `GET /auth/:strategy/start`,
`GET /auth/:strategy/callback`, and `POST /auth/logout`. Start derives the exact
callback path on the request origin and returns a `303` to the selected strategy
authorization URL. Callback requires one route-safe state value, bounds provider
codes before they reach a strategy, consumes recognizable state even when the
code is missing, duplicated, or oversized, and returns a `303` only to the local
path saved at start. Logout accepts only a bounded URL-encoded form with one
`csrf_token`; the repository compares it against the current authenticated
record while atomically revoking that record. Success creates a distinct guest
logical session and bearer, stages it through the central request boundary, and
returns `303 /`. Duplicate, missing, stale, cross-session, and replayed logout
tokens cannot revoke authenticated access. Responses are `no-store` with
`Referrer-Policy: no-referrer`; errors use generic text/status mappings and
restrictive content headers. Diagnostics carry only request ID, optional
validated strategy ID, and an internal category. Raw query/form values, cookies,
tokens, and provider causes are absent.

The gauth adapter supplies the exact `openid email profile` scope,
application-owned state, and callback URI. It persists only the returned PKCE
verifier as opaque server-side attempt context, maps the verified Google subject
and profile fields, and discards access, ID, and refresh tokens. Missing
verifier context and all gauth failures become the provider-neutral failure
result; raw `GAuthErr` causes do not cross the adapter boundary.

The configured composition root requires an explicit `local` or `original`
Google mode, loads only that gauth preset, constructs the adapter, and registers
the `google` strategy. Both modes require the exact absolute
`/auth/google/callback` URL without credentials, query, or fragment. Local mode
also requires a same-origin `/auth/google/mock-consent` URL and is restricted to
loopback hosts so fake authentication cannot be configured for a deployment.
Original mode requires the Google client ID and secret and rejects non-HTTPS
callbacks outside loopback development. Missing, whitespace-padded, oversized,
or mode-inconsistent values fail before shared application services are created;
diagnostics name variables but never values.

`deno task dev` explicitly supplies the local session and Google modes plus the
two localhost URLs. Other startup commands must provide
`IAM_PAGER_GOOGLE_AUTH_MODE`, `IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI`, and either
`IAM_PAGER_GOOGLE_AUTH_MOCK_CONSENT_URL` for local mode or
`IAM_PAGER_GOOGLE_AUTH_CLIENT_ID` and `IAM_PAGER_GOOGLE_AUTH_CLIENT_SECRET` for
original mode.

Local mode serves `GET /auth/google/mock-consent` through gauth's package
renderer. The boundary requires exactly the generated 256-bit state,
`openid email profile` scope, and configured callback URI before rendering; it
is unavailable in original mode. Its response is no-store and no-referrer, and
its CSP permits only the package's inline script/style and same-origin callback
form. The verified browser flow preserves the guest logical session, upgrades it
to authenticated, publishes a rotated bearer, and rejects the stale guest bearer
without provider network access or credentials.

The site header consumes only the output of `SiteNavigationPresenter`, not the
session itself. For a guest, the presenter validates the current path and query
as a local return and generates the Google start link. For an authenticated
session, it emits signed-in state and a fixed `POST /auth/logout` form
containing the server-owned synchronizer token. The model does not expose the
logical session ID or user ID, and the UI component does not decide which
actions are authorized. No account/profile or authenticated publishing behavior
is implied by this header state.

## Storage limitation

`MemorySessionRepository` and `MemoryIdentityRepository` are process-local.
Restarting the process invalidates all sessions and loses users/identities, and
multiple app instances do not share either state. They are not production
durability or horizontal-scaling solutions. Repository interfaces are the
replacement boundaries; cookie transport remains independent from session
storage.

## Next boundary

The authentication foundation is complete through trusted site navigation. Next,
introduce persistent namespace ownership and apply authenticated authority to
publishing before exposing creator management controls.
