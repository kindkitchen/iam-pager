# Session and authentication

## SA-SESSION — Session model

Every routed application request resolves to exactly one typed `guest` or
`authenticated` session and receives a server-generated request ID. Missing,
malformed, unknown, expired, or revoked bearers create a fresh guest; caller
input can never select an identity.

A logical session ID and its bearer are distinct. Repositories persist only the
bearer's SHA-256 lookup hash. Authentication preserves the guest logical session
for attributable activity but atomically rotates the bearer and session version.
The previous bearer stops resolving immediately.

Default lifecycle values are:

- guest absolute lifetime: 7 days;
- authenticated idle lifetime: 30 days;
- authenticated absolute lifetime: 90 days;
- renewal threshold: 1 day;
- authentication-attempt lifetime: 10 minutes;
- pending attempts per guest session: 5.

`SessionRepository` owns atomic create, renewal, attempt consumption, upgrade,
logout, and revocation behavior. Memory and Deno KV satisfy the same conformance
suite. Deno KV records use absolute-expiry TTLs while service checks remain
authoritative.

## SA-COOKIE — Browser transport

`CookieSessionStrategy` is independent from session storage. Production uses
`__Host-iam_pager_session` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
explicit expiry, and no `Domain`. Local development explicitly selects the
distinct non-secure `iam_pager_session_local` cookie.

`RequestContextMiddleware` resolves the session before a route and adds only the
request ID and any pending cookie to the returned response. It preserves route
status, body stream, content length, existing cookies, disposition, and content
isolation headers. A route-owned credential rotation supersedes renewal selected
when the request began.

## SA-IDENTITY — External identity

Identity uniqueness is exact `(strategy_id, provider_subject)`. Verified email,
display name, and picture are mutable profile attributes and never link accounts
across strategies. `IdentityRepository` atomically finds or creates the
application user and ignores older concurrent profile observations.

Authentication establishes identity only. Namespace reservation separately
establishes publishing authority.

## SA-ATTEMPT — Authentication attempt

`AuthenticationService` generates 256-bit state and stores only its hash with
the guest session, selected strategy, exact callback URL, validated local
return, provider context, and expiry. Attempts are session-owned, one-use,
expiring, and bounded. Starting a sixth live attempt evicts the oldest.

Callback handling consumes the attempt before provider exchange. Malformed,
expired, mismatched, cross-session, and replayed state cannot upgrade a session.
A successful callback saves verified identity, upgrades the logical session,
rotates the bearer, and creates a separate 256-bit CSRF token.

## SA-HTTP — Browser authentication boundary

The generic browser surface is:

- `GET /auth/:strategy/start`;
- `GET /auth/:strategy/callback`;
- `POST /auth/logout`.

Start and callback use bounded query values, validated local return paths,
`no-store`, and `Referrer-Policy: no-referrer`. Return paths must be local
absolute paths and reject protocol-relative, encoded external, backslash,
credential, and control-byte forms.

Callback errors use site-owned restrictive HTML and a safe retry link. Callback
values and provider causes never enter the model or diagnostics. Logout accepts
one bounded form CSRF token, atomically revokes the current authenticated
bearer, and publishes a distinct fresh guest session. Stale, cross-session, and
replayed tokens cannot log out another session.

## SA-GOOGLE — Google strategy

`GoogleGAuthStrategy` is the current `AuthenticationStrategy`. It uses gauth
0.4.1, exact `openid email profile` scope, server-side PKCE context, and
verified Google subject/profile fields. Provider access, ID, and refresh tokens
are discarded. Provider-specific errors do not cross the strategy boundary.

Startup selects one explicit mode:

- `local`: loopback-only mock consent for development, or a deliberately narrow
  HTTPS request-host pattern for fake-auth previews;
- `original`: Google credentials and an authorized callback URL.

Without a host pattern, configured callback URLs are authoritative. With a
pattern, the complete case-insensitive `Request.url` host (including a
non-default port) must match and the scheme must be HTTPS; fixed callback paths
are then built with the URL API. `Origin` and `Referer` are never authorities.
Every local-mode matched host permits fake sign-in and must exclude production.

The local consent route validates exact state, scope, and same-origin callback
before rendering gauth's screen. It is unavailable in original mode.

## SA-APIKEY — API-key credential

An API key is an owner automation credential for `/api/**` only. It is not a
session: it has no cookie, CSRF token, OAuth attempt, idle renewal, or site or
direct-content authority. A bearer is `iamp_` plus 43 base64url characters (256
random bits), returned exactly once at creation; persistence keeps only its
SHA-256 lookup hash, metadata, owner index, and revocation state.

Keys carry explicit `read`/`write`/`delete` grants. The `all` shorthand must
appear alone and expands to the complete current explicit set at write time,
never silently to future permissions. Expiry is an optional exact instant;
expired keys stay browser-manageable but stop authenticating. Metadata updates
are revision-bound with strong ETags.

A present `Authorization` header is authoritative on `/api/**`: bearer requests
never resolve, renew, or create a browser session and receive an ephemeral guest
view; malformed, unknown, expired, and revoked bearers share one non-disclosing
`401` challenge without cookie fallback. Key management is browser-owned; bearer
revoke-all under the `delete` permission is the single key-accessible management
operation and revokes the calling key atomically with every sibling. The exact
wire contract is [the API authentication reference](../api/authentication.md)
and [the API-key API](../api/api-keys.md).

## SA-PRESENTATION — Site navigation

`SiteNavigationPresenter` receives the typed server session and returns a
complete guest sign-in link or authenticated CSRF-protected logout form.
Components receive neither session/user IDs nor responsibility for deciding the
available action.

## SA-STORAGE — Persistence

Sessions default to process memory. Durable sessions require the same durable
ownership database as users, identities, and namespace claims. Otherwise a
surviving session could reference a missing user. Page persistence is selected
independently under the same durability requirement; API keys inherit the
ownership backend by default so durable users never silently receive
process-local keys.
