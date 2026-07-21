---
name: web-multi-reference-ux
description: Align the web UI with multi-reference pages and move public exploration to a dedicated navigable page. Load when working on publishing references, PDF delivery controls, owned namespace selection, management projections, or Explore navigation.
created: 2026-07-21
updated: 2026-07-21
tags: [web, ux, pages]
relates: []
---

The domain and API support one logical content item at one or more locator references, but the web still assumes a preferred inline PDF path plus a mandatory download alias in one namespace.

Working decisions:
- Require one primary path and allow zero or more optional aliases; every path references the same logical page/content.
- For PDF paths, expose a `Downloadable` checkbox: checked maps that path to `attachment`, unchecked maps it to `inline`. One path cannot provide both response modes; add an optional alias when both are needed.
- Signed-in creators select namespaces from their owned reservations for every path; guest free-text/random namespace entry remains unchanged.
- Move public exploration to `/site/explore` and expose it in site navigation.

Next: generalize presenter-owned publishing and management models, implement the dedicated exploration view, add regression coverage, and update all product/API documentation together.
