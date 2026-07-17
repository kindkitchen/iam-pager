---
name: content-publishing
description: Implement content publishing — strategy-based locator engine (interface-first), interface-first content CRUD, MdPage content type, guest MdPage creation on the site, and SPA site under the /site alias. Load when working on publishing, locators, content types, or site/raw routing.
created: 2026-07-17
updated: 2026-07-17
tags: [backend, frontend, publishing]
relates: []
---

Not started. Requirements captured in [[001.draft]].

Scope: locator engine with pluggable strategies (first path slug = namespace,
rest = page name), `/site` alias serving the SPA (namespace `site` forbidden),
content CRUD as satisfiable interfaces, first content type `MdPage` (md input,
derived html, optional css), guest creation flow on site, open-by-locator.

Next: design the locator strategy interface and the content CRUD interface, then
implement the first strategy and MdPage.
