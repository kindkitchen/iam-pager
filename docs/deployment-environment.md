# Deployment environment

The tracked [`.env.example`](../.env.example) is the complete catalog of
application environment variables. Each entry records its runtime context,
plain-text or secret classification, requirement, and accepted role.
Deno-provided variables that iam-pager does not read are intentionally omitted.

Copy the catalog before entering real values:

```sh
cp .env.example .env.production.local
```

`.env.production.local` is gitignored. Remove entries that do not apply, replace
all active placeholders, and never put credentials in `.env.example`. Local
`deno task dev` already supplies its memory, cookie, and mock-OAuth settings. No
application variable is required in Deno Deploy's Build context.

For Deno Deploy, use `deno-kv` for the three required storage selectors and
leave `IAM_PAGER_OWNERSHIP_DENO_KV_PATH` unset so `Deno.openKv()` uses the
attached database. `DENO_KV_ACCESS_TOKEN` is only for a self-hosted process
opening remote KV; the current Deploy platform rejects user-defined `DENO_` keys
and does not need it for an attached database.

## Deno Deploy bulk import

Research checked against the current Deno Deploy documentation and CLI on
2026-07-23:

- The dashboard's **Add from .env file** action and
  `deno deploy env load <file>` batch-import standard dotenv assignments. Lines
  beginning with `#` are comments.
- Dotenv has no syntax for Deno Deploy context or secret metadata. The
  `Context:` and `Type:` comments in `.env.example` are ignored by importers.
- Secret status is guessed from the key name; it is not read from an explicit
  per-line marker. The current CLI treats names containing `KEY`, `SECRET`,
  `TOKEN`, `PASSWORD`, `PRIVATE`, `CREDENTIALS`, or `AUTH` as likely secrets,
  with public-name exceptions.
- The heuristic correctly catches this project's client secrets, KV access
  token, and storage token key. It incorrectly catches all
  `IAM_PAGER_GOOGLE_AUTH_*` plain settings and the optional
  `IAM_PAGER_API_KEY_STORAGE_BACKEND`; review those classifications.
- In `@deno/deploy` CLI 0.0.9904, a newly loaded variable receives **All**
  contexts. Replacing an existing variable preserves its contexts. The load
  command has no context option and ignores comment annotations.

For an initial setup, paste the private file into the dashboard, correct every
secret toggle and context in the drawer, then save. This avoids temporarily
making production credentials available to Development or Build. For later
updates, CLI load preserves contexts already assigned in the dashboard:

```sh
deno deploy env --org YOUR_ORG --app YOUR_APP load \
  .env.production.local --replace \
  --non-secrets \
  IAM_PAGER_GOOGLE_AUTH_MODE \
  IAM_PAGER_GOOGLE_AUTH_REDIRECT_URI \
  IAM_PAGER_GOOGLE_AUTH_MOCK_CONSENT_URL \
  IAM_PAGER_GOOGLE_AUTH_CLIENT_ID \
  IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN \
  IAM_PAGER_GOOGLE_DRIVE_MODE \
  IAM_PAGER_GOOGLE_DRIVE_REDIRECT_URI \
  IAM_PAGER_GOOGLE_DRIVE_MOCK_CONSENT_URL \
  IAM_PAGER_GOOGLE_DRIVE_CLIENT_ID \
  IAM_PAGER_GOOGLE_DRIVE_REQUEST_HOST_PATTERN \
  IAM_PAGER_API_KEY_STORAGE_BACKEND
```

Use `deno deploy env list` to verify the resulting classifications and contexts.
`deno deploy env update-contexts <name> <contexts...>` can correct a single
variable, but there is no supported dotenv annotation that applies those
contexts automatically. Production and Development may use different values for
the same name; configure non-overlapping context-specific rows in the Dashboard
when needed, especially for OAuth callback URLs and credentials.

A credential-free HTTPS preview must explicitly select local mode for both
Google integrations. A host pattern alone does not override `original` mode:

```env
IAM_PAGER_GOOGLE_AUTH_MODE=local
IAM_PAGER_GOOGLE_AUTH_REQUEST_HOST_PATTERN=iam-pager-pr-[a-z0-9-]+\.example\.com
IAM_PAGER_GOOGLE_DRIVE_MODE=local
```

Local Drive inherits the validated auth pattern when
`IAM_PAGER_GOOGLE_DRIVE_REQUEST_HOST_PATTERN` and a complete static Drive URL
pair are unset; configure that variable only when Drive needs a narrower host
policy. Do not assign the corresponding redirect URIs, mock-consent URLs, client
IDs, or client secrets to that preview context. The matched HTTPS request
supplies the origin; application-owned callback paths remain fixed. Local mode
grants fake identity and Drive consent, so the pattern must not match
production.

Sources:

- [Deno Deploy environment variables and contexts](https://docs.deno.com/deploy/reference/env_vars_and_contexts/)
- [`deno deploy env` CLI reference](https://docs.deno.com/runtime/reference/cli/deploy/#environment-variables-management)
- [Deno Deploy changelog](https://docs.deno.com/deploy/changelog/)
- [`@deno/deploy` 0.0.9904 env command source](https://jsr.io/@deno/deploy/0.0.9904/deploy/env.ts)
