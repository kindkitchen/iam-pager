# Project specification

These documents define the current product and its implementation boundaries.
They are requirements, not a delivery log. Stable section labels can be cited by
code, tests, and future tasks without depending on section order.

| Document                                                                       | Purpose                                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [product-definition.md](product-definition.md)                                 | Goal, users, and scope                                          |
| [domain-and-addressing.md](domain-and-addressing.md)                           | Page, locator, asset, endpoint, access, and lifecycle rules     |
| [experiences-and-scope.md](experiences-and-scope.md)                           | Visitor, guest, and creator behavior                            |
| [capabilities.md](capabilities.md)                                             | Application interfaces and outcomes                             |
| [external-storage.md](external-storage.md)                                     | Selected external-content custody and failure contract          |
| [quality-and-technical-requirements.md](quality-and-technical-requirements.md) | Architecture, storage, HTTP, security, limits, and verification |
| [session-and-authentication.md](session-and-authentication.md)                 | Session, Google authentication, and API-key invariants          |
| [open-scope-and-risks.md](open-scope-and-risks.md)                             | Deliberately unimplemented scope and active risks               |

## SP-CORE — Product shape

- Content is published at one or more deterministic namespace and optional
  page-name locators.
- Direct access returns content, not the management site's shell.
- The site provides publishing, wrapped viewing, public exploration, and creator
  management as projections of shared application logic.
- Authentication lets creators reserve namespaces and protect pages.
- Creators may issue scoped API keys that automate the owner API without
  becoming browser sessions.
- Guests may publish public, undiscoverable trial pages without ownership.
- A logical content item is independent of its non-empty locator-reference set;
  one or many explicit delivery endpoints may expose the same current asset
  while it remains one managed and explored item.
- Markdown and PDF are the supported content types. External storage is a
  selected next capability for their validated payloads, with local metadata and
  iam-pager delivery; it remains unavailable until its implementation tasks
  land.
