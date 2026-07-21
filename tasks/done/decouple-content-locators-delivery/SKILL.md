---
name: decouple-content-locators-delivery
description: Separate published content from its locator references and make delivery mode explicit and format-validated. Load when changing content publication, locator bindings, delivery behavior, or the page API.
created: 2026-07-21
updated: 2026-07-21
tags: [content, locators, api]
relates: []
---

Completed the content/locator/delivery refactor. Logical content now has one non-empty, format-neutral locator-reference set; each reference carries an extensible handler-supported delivery profile, and references may span actor-authorized namespaces.

PDF has no special cardinality or profile-pair rule, content-only replacement preserves references, and JSON/multipart APIs share explicit endpoint intent. Deno KV reports its eight-reference atomic adapter capacity without making it a domain rule.

The unchanged site's conflicting assumptions are documented. Repository checks, all 448 tests, and the production build pass.
