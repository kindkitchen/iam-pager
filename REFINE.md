# Specification refinement notes

The first generated specification was rigorous but too focused on its own status
rules, identifiers, blockers, and production governance for a pre-MVP app. The
current `docs/specification/` keeps the useful product clarifications while
returning to the intent of `README.md`.

## Applied refinements

- The specification describes app behavior directly and uses stable semantic
  section markers, based on short file prefixes, without numbered sequences.
- Product behavior remains independent from replaceable implementation choices;
  in particular, locators do not assume a path, subdomain, or other URL mapping.
- The main product remains publishing, directly opening, exploring, and managing
  content through deterministic URLs.
- Guest publishing is a small extension of normal publishing: even an unknown
  visitor may publish, but with stricter limits and no reserved namespace.
- Guest locator overwrite is an explicit owner decision. A guest locator may be
  replaced by another guest or by an authenticated creator using the same
  namespace; protected namespaces remain protected.
- The original API-focused sharing direction is restored through publishing,
  direct retrieval, and authenticated management behavior.
- Varied content formats and sizes remain a product need even though external
  storage providers are deferred.
- Prototype choices can be recorded and changed without first resolving every
  production concern.

## Nearby issues retained

- Missing direct pages should return an intentional missing-page response rather
  than a successful home-page fallback.
- Active creator content must not gain access to authenticated management
  sessions.
- Short page locators must not collide with site, API, framework, or asset
  routes.
- Guest capacity behavior still needs a concrete meaning for which item is
  removed, or whether a new item is rejected.
- Authenticated content should be protected from other users, but the product
  should not make an absolute promise of permanent storage.
