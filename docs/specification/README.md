# Project specification

Section markers use a short file prefix and a stable descriptive word, such as
`DA-LOCATOR`. Tasks can cite these markers without depending on section order.

## SP-SHAPE — Product shape

- A person publishes content at a deterministic locator made from a namespace
  and an optional page name.
- Direct access returns the content itself without the management site's visual
  shell.
- The site supports public exploration, wrapped page viewing, and authenticated
  content management.
- Authentication reserves a namespace and protects its pages.
- Content can have different formats and sizes; external storage is a later
  extension of that need.
- Even a guest may publish, but with stricter limits and without a reserved
  namespace or overwrite protection.

## SP-MAP — Documents

| File                                                                           | Purpose                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| [product-definition.md](product-definition.md)                                 | Product idea, users, MVP, and boundaries         |
| [experiences-and-scope.md](experiences-and-scope.md)                           | Visitor, explorer, publisher, and creator flows  |
| [domain-and-addressing.md](domain-and-addressing.md)                           | Pages, namespaces, locators, content, and access |
| [capabilities.md](capabilities.md)                                             | Functions the app exposes                        |
| [quality-and-technical-requirements.md](quality-and-technical-requirements.md) | Important technical behavior and constraints     |
| [session-and-authentication.md](session-and-authentication.md)                 | Session lifecycle boundaries and current status  |
| [open-questions-and-risks.md](open-questions-and-risks.md)                     | MVP decisions and nearby implementation risks    |
| [delivery-slices.md](delivery-slices.md)                                       | App-focused increments for building the product  |
