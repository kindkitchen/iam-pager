---
name: web-navigation-hub
description: Site home is a navigation hub over one site map, publishing lives at /site/publish, and PDF delivery uses a modelled choice control. Load when touching site routes, navigation, the publish form, or reference-path editing.
created: 2026-07-25
updated: 2026-07-25
tags: [web, navigation, ui]
relates: []
---

Done and verified (see [[002.summary]]).

Destinations are declared once in `lib/ui/site-map.ts`; navigation, home hub
(`lib/ui/site-home.ts`), and breadcrumbs are projections of it — add a
destination there first, then a thin route under `routes/site/`. Editorial
pages (about, demo, invite) share `lib/ui/site-editorial.ts` and
`components/SiteEditorial.tsx`. PDF delivery selection is
`components/DeliveryProfileField.tsx`, used by both the publish island and the
"Edit paths" editor.

Open follow-ups: none required. Optional next steps — move remaining
`public-page-platform-header` markup onto `SitePageHeader`, and give the demo
route a live, non-publishing editor preview.
