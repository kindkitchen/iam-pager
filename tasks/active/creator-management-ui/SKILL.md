---
name: creator-management-ui
description: Complete DS-PROTECT with a creator site management UI over the existing page-management contracts. Load when working on the managed-pages site panel, page inspection/editing UI, or access and delete controls.
created: 2026-07-19
updated: 2026-07-19
tags: [frontend, api, management]
relates: [public-view-capability]
---

Active head of the 2026-07-19 development chain
(`creator-management-ui -> public-view-capability -> public-exploration ->
management-expansion`).

Goal: complete DS-PROTECT by giving the authenticated creator a site management
UI over the existing page-management contracts: list managed pages, inspect
one, edit content with the existing editor stack, toggle public/private, and
delete. No new business logic in the web layer; `PageService` and the
`/api/pages` contracts stay authoritative.

Not started. See [[001.draft]] for scope, non-goals, acceptance, and the
project invariants to preserve.
