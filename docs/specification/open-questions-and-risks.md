# Open questions and nearby risks

## OQ-SETTLED — Settled directions

### OQ-LOCATOR — Locator abstraction

The functional locator is a namespace plus an optional page name, as defined by
`DA-LOCATOR`. The specification does not choose between a path, subdomain, or
another public URL mapping. A deployment must select and validate a concrete
mapping, but that choice is not an open product question and must not change
publishing, search, ownership, or page resolution behavior.

### OQ-GUEST — Guest publishing

Guest publishing is a limited form of normal publishing, not a separate product
direction. A guest has stricter limits and does not reserve the namespace;
overwrite behavior is accepted as described by `DA-NAMESPACE`.

### OQ-AUTH — Account entry and recovery

The first account-entry flow is Google-first sign-in: a verified Google subject
atomically finds or creates one application user and external identity, so there
is no separate registration form or application password. The guest logical
session is upgraded in place to preserve attributable guest activity while its
bearer rotates; matching email never links another provider identity.

Account recovery for this flow belongs to Google. The application provides no
password reset or provider-account recovery, and its current process-local
identity storage is not durable account persistence. Logout revokes the
currently authenticated session and establishes an unrelated fresh guest; it
does not delete the application user or provider identity. Namespace reservation
and concurrent uniqueness are a subsequent authorization capability, not an
effect of authentication itself.

## OQ-OPEN — MVP decisions still needed

### OQ-CONTENT — Supported content

Choose the first media types and size bands. For each type, decide whether the
direct response displays it, downloads it, or can do either. Active HTML, SVG,
and scripts need an explicit isolation choice before they are served.

The initial set can be narrow, but it should test both textual and binary
content so the app does not become accidentally text-only.

### OQ-LIMITS — Publishing limits

Choose initial limits for content size, total stored size, page count, and
frequency. Guest publishing uses stricter limits and no namespace guarantee. The
original guest-capacity phrase "removes the latest" still needs one concrete
meaning: remove an existing item, expire items, or reject the new item.

### OQ-ACCESS — Public and private behavior

For authenticated pages, settle the exact transition between public, directly
accessible content and private content available only to the creator's session.
Decide how quickly access and exploration reflect that change.

### OQ-API — API surface

Choose the smallest programmatic publishing and direct-retrieval request and
response contracts. Authenticated management should extend the same application
behavior rather than creating separate rules for the UI and API. Concrete API
routing remains an integration choice.

### OQ-EXPLORE — Public exploration

Decide whether the first exploration version includes only page names,
namespaces, and tags, or also text-content matches. View-count sorting is not
required unless reliable counts become useful to the MVP.

### OQ-RETENTION — Retention

State practical cleanup, deletion, and backup behavior. Avoid an absolute
promise that authenticated content can never disappear; the first version only
needs understandable normal-operation behavior.

## OQ-RISKS — Nearby risks

### OQ-ISOLATION — Direct-content isolation

Raw HTML or another active format can conflict with authenticated site sessions
if it shares the same browser trust boundary. The chosen routing and response
model must keep creator content from acting as the management site.

### OQ-ROUTES — Route collisions

A concrete public URL mapping can collide with application and API routes. Its
routing adapter must reserve or separate those routes before URLs are presented
as stable.

### OQ-MISSING — Missing-page fallback

Silently returning the home page for a missing direct URL makes clients believe
the content request succeeded. Use a real missing-page response, optionally with
a link to the site.

### OQ-FORMATS — Broad content support

Different formats and large files are part of the product direction, but trying
to support everything immediately would obscure the core publishing and direct-
delivery flow. Start with an explicit subset and keep external storage for
later.
