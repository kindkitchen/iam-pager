# iam-pager

`iam-pager` is a content-publishing service built around addressable pages. A
page gives creator-managed content a stable locator and can be delivered either
directly or through the management and discovery site.

The project is currently in product-definition and technical-prototype stage.
The generated Fresh application is only a starting point; it does not yet
implement the product behavior described below.

## Product direction

The project has two connected surfaces:

1. **Content delivery and discovery** — resolve a page locator, return its
   content with appropriate HTTP semantics, and allow eligible public pages to
   be found through the site.
2. **Content management** — let authenticated creators own namespaces and
   create, update, classify, publish, and remove pages.

Guest publishing and external storage providers remain candidate capabilities,
not committed MVP scope. Both introduce unresolved ownership, security, abuse,
and lifecycle requirements.

## Specification

The project specification is the source of truth for product and technical
scope:

- [Specification guide](docs/specification/README.md)
- [Product definition](docs/specification/01-product-definition.md)
- [Experiences and scope](docs/specification/02-experiences-and-scope.md)
- [Domain and addressing](docs/specification/03-domain-and-addressing.md)
- [Capabilities](docs/specification/04-capabilities.md)
- [Quality and technical requirements](docs/specification/05-quality-and-technical-requirements.md)
- [Open questions and risks](docs/specification/06-open-questions-and-risks.md)
- [Delivery slices](docs/specification/07-delivery-slices.md)

Open decisions in the specification must not be treated as implied requirements.
Work should be shaped from the delivery slices only after its blocking decisions
are resolved.

## Current technical baseline

- TypeScript with strict type checking
- Deno runtime
- Fresh 2 with Preact and Vite

The persistence, identity, content-storage, search, deployment, and external
provider designs are intentionally undecided.

## Development

```sh
deno task dev
deno task check
deno task build
```
