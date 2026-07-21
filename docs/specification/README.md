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
| [quality-and-technical-requirements.md](quality-and-technical-requirements.md) | Architecture, storage, HTTP, security, limits, and verification |
| [session-and-authentication.md](session-and-authentication.md)                 | Session and Google authentication invariants                    |
| [open-scope-and-risks.md](open-scope-and-risks.md)                             | Deliberately unimplemented scope and active risks               |

## SP-CORE — Product shape

- Content is published at a deterministic namespace and optional page-name
  locator.
- Direct access returns content, not the management site's shell.
- The site provides publishing, wrapped viewing, public exploration, and creator
  management as projections of shared application logic.
- Authentication lets creators reserve namespaces and protect pages.
- Guests may publish public, undiscoverable trial pages without ownership.
- A logical page can expose several explicit delivery endpoints over one content
  asset while remaining one managed and explored item.
- Markdown and PDF are the supported content types; broader formats and external
  storage remain later scope.
