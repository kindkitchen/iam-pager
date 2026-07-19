---
name: public-view-capability
description: DS-VIEW site-mediated viewing - a pure-logic public view contract (public page for viewing, creator public listing, default-page link) plus the thin site wrapper. Load when starting after creator-management-ui or working on wrapped page viewing.
created: 2026-07-19
updated: 2026-07-19
tags: [backend, frontend, delivery]
relates: [creator-management-ui, public-exploration]
---

Chain position 2 of 4: starts after `creator-management-ui` completes; feeds
`public-exploration`, whose results land on this wrapper and reuse its
public-listing primitive.

Goal: DS-VIEW. First a web-independent public-view contract in `lib/` (resolve
an eligible public page for wrapped viewing, list a creator's public pages,
locate the namespace default page), then the thin site wrapper with
preview/fallback, direct-content link, creator default-page link, and
other-public-pages links.

Not started. See [[001.draft]].
