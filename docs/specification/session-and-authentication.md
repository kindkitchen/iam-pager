# Session and authentication foundation

## Current implementation boundary

The first authentication milestone implements the transport-independent session
lifecycle under `lib/session/`. It is application logic, not Fresh route logic:

- `SessionService` resolves a bearer credential to exactly one discriminated
  `guest` or `authenticated` session;
- `SessionRepository` owns atomic creation, bounded renewal, credential rotation
  during upgrade, and revocation;
- `MemorySessionRepository` is the first implementation;
- clock, logical-ID, and credential generation are injectable interfaces;
- the production generators use UUID logical IDs and 256-bit random base64url
  credentials.

Cookie transport and root request middleware are the next milestone. Until they
are wired, the web app does not issue session cookies or add session state to
Fresh requests.

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

## Storage limitation

`MemorySessionRepository` is process-local. Restarting the process invalidates
all sessions, and multiple app instances do not share session state. It is not a
production durability or horizontal-scaling solution. The repository interface
is the replacement boundary; cookie transport must remain independent from the
chosen storage implementation.

## Next boundary

The next phase adds an explicit production/local cookie strategy and root Fresh
middleware. Every request reaching application routing will then receive a new
server-generated request ID and resolved session, while static/framework assets
served before application routing remain outside that guarantee. The middleware
must preserve direct-content bodies, lengths, and isolation headers.
