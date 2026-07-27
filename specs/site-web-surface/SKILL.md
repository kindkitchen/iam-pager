---
name: site-web-surface
description: How the /site projection is structured - site map, hub, publish route, reference editing, delivery control. Load when touching site routes, navigation, publishing, or management UI.
updated: 2026-07-25
sources: [web-navigation-hub, web-multi-reference-ux]
---

The web is one projection of `lib/`. Components render server-owned models and
never decide authority, persistence, or domain rules; they consume
presenter-declared content-format and delivery-profile capabilities.

## Navigation

`lib/ui/site-map.ts` declares every destination once (`audience`, `group`,
`in_navigation`, `in_hub`) behind `SiteMapReader`. Navigation
(`site-navigation.ts`), the home hub (`site-home.ts`, grouped `create` /
`discover` / `learn` / `account` sections), and breadcrumbs (`site-breadcrumb.ts`)
are projections of it. Adding a destination means editing the map first, then a
thin route under `routes/site/`.

- `/` and `/site` render the hub only — no publish form, no management panel.
- `/site/publish` is the full-width publishing surface.
- `/site/explore` is the canonical public exploration destination; old
  query-bearing home URLs redirect there.
- `/site/manage` holds creator management plus namespace reservation.
- `/site/about`, `/site/demo`, `/site/invite` share `lib/ui/site-editorial.ts`
  and `components/SiteEditorial.tsx`; invite is session-dependent.
- `components/SiteNavigation.tsx` exports `SiteSessionNavigation` and the shared
  `SitePageHeader` used by every destination.

## References and delivery

Publishing submits explicit `endpoint_set` requests: one required primary path
plus zero or more removable aliases for the same logical content (not copies).
Creators pick namespaces from their owned reservations for the primary and each
alias, and may mix owned namespaces; a creator with no reservation cannot fall
back to guest publication. Guest free-text/random namespace controls are
unchanged.

Delivery profile is chosen with `components/DeliveryProfileField.tsx` in both the
publish island and the "Edit paths" editor; publish state stores
`delivery_profile`, never a boolean, and never infers behavior from suffix or row
position. One URL has one profile — both browser opening and forced download
require two references. Server capacity failures are surfaced as-is; the KV
eight-reference limit is not re-encoded as a UI rule.

Management renders every returned reference with its actual profile, supports
revision-bound replacement of the complete set, and omits `endpoint_set` on
content-only replacement so aliases survive. Guest-only notices (for example
"unreserved pages remain unprotected") are not shown to creators.

## Styling conventions

Shared `.choice-group` / `.choice-options` / `.choice-option` and `.toggle-field`
classes replace bare checkboxes. `.site-page-header` replaces the old `.hero`.
The publish surface is a centred `108rem` single-column shell with capped setup
fields and clamped editor/preview heights.

## Optional follow-ups

Move remaining `public-page-platform-header` markup onto `SitePageHeader`; give
`/site/demo` a live, non-publishing editor preview.
