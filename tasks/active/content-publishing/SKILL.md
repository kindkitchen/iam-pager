---
name: content-publishing
description: Implement content publishing — strategy-based locator engine (interface-first), interface-first content CRUD, MdPage content type, guest MdPage creation on the site, and SPA site under the /site alias. Load when working on publishing, locators, content types, or site/raw routing.
created: 2026-07-17
updated: 2026-07-18
tags: [backend, frontend, publishing]
relates: []
---

Active. Requirements in [[001.draft]]; design decisions in [[003.analysis]];
code review in [[004.review]].

Done: routing-agnostic domain layer under `lib/` — locator model with
case-insensitive `locator_key`, `LocatorStrategy` interface, `LocatorEngine`
(strategy registry + forbidden-namespace policy, `site` forbidden),
`PathSlugStrategy` (first slug = namespace, rest = page name), and
interface-first content contracts (`ContentTypeHandler`, `ContentRepository`,
`ContentRecord`). 23 tests pass; `deno task check` clean.

Next: `MdPage` handler (needs markdown dependency + sanitization decision),
in-memory `ContentRepository`, publish/deliver use-cases; then HTTP wiring
(`/site` alias, root SPA, catch-all raw delivery) and the guest creation flow.

Carry-over from review: forbid `/` in namespaces when charset validation lands;
store original-cased `Locator` alongside content (likely `PageRecord`).
