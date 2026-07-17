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
invariants settled in [[007.decision]]; HTTP wiring in [[008.log]].

Done: routing-agnostic domain layer under `lib/` — locator model with
case-insensitive `locator_key`, `LocatorEngine` (strategy registry +
forbidden-namespace policy), `PathSlugStrategy`; content contracts plus
`MdPageHandler` (sanitized html derived at publish time) and
`MemoryContentRepository`; `PublishingService` (`PagePublisher` /
`PageDeliverer`, `validate -> derive` as the only path into storage, meta from
deterministic `render`). HTTP wiring: composition root `lib/app.ts` (forbidden
namespaces `site`, `api`), delivery response mapping `lib/publishing/http.ts`
(intentional statuses/headers, `no-store`, inline/attachment disposition,
active-content CSP sandbox), catch-all route `routes/[...path].ts`, site shell
at `/` and `/site/*` (`components/SiteApp.tsx`). 57 tests pass;
`deno task check` clean.

Next: guest creation flow — publish API endpoint over
`PublishingService.publish`, site form island that submits an `MdPage`
(namespace + optional page name + md + optional css) and links to the returned
path. Guest placement is create-or-replace; no update flow (001.draft).

Carry-over: forbid `/` in namespaces when charset validation lands
([[004.review]] item 2); repository returns live references ([[006.review]] item
3, fine for the in-memory slice); no cache validators yet — delivery is
`no-store` ([[008.log]]).
