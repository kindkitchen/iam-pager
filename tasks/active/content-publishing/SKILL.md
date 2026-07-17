---
name: content-publishing
description: Implement content publishing — strategy-based locator engine (interface-first), interface-first content CRUD, MdPage content type, guest MdPage creation on the site, and SPA site under the /site alias. Load when working on publishing, locators, content types, or site/raw routing.
created: 2026-07-17
updated: 2026-07-18
tags: [backend, frontend, publishing]
relates: []
---

Active. Requirements in [[001.draft]]; locator design in [[003.analysis]] /
[[004.review]]; content design in [[005.analysis]] / [[006.review]]; publish
invariants settled in [[007.decision]].

Done: routing-agnostic domain layer under `lib/` — locator model with
case-insensitive `locator_key`, `LocatorEngine` (strategy registry +
forbidden-namespace policy, `site` forbidden), `PathSlugStrategy`;
interface-first content contracts plus first implementations: `MdPageHandler`
(`@deno/gfm`, sanitized html derived at publish time, css breakout neutralized)
and `MemoryContentRepository` (`PageRecord` keeps original locator casing);
publish/deliver use-case layer (`lib/publishing/`): `PublishingService`
implements `PagePublisher` / `PageDeliverer`, owns `validate -> derive` as the
only path into storage, computes `ContentMeta` from deterministic `render`
output at publish time. 48 tests pass; `deno task check` clean.

Next: HTTP wiring — `/site` alias, root SPA, catch-all raw delivery route on
top of `PublishingService` — then the guest creation flow on the site.

Carry-over: forbid `/` in namespaces when charset validation lands
([[004.review]] item 2); repository returns live references ([[006.review]]
item 3, fine for the in-memory slice).
