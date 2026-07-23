---
name: external-storage-management-surface
description: Completed Step 9 of external-content-storage - API and web UI for storage connections and external publish/replace custody. Load when maintaining the creator storage settings or external publication UX.
created: 2026-07-22
updated: 2026-07-22
tags: [external-storage, ui, api]
relates: [external-content-storage, external-missing-owner-warning, google-drive-oauth-connection]
---

Completed the creator-facing external-storage composition.

Connection APIs and `/site/manage` expose only owner-safe metadata, support
Google Drive connect/reconnect/disconnect, and warn that dependent assets are
not blockers. Active write-capable connections appear in Markdown/PDF publish
and replacement flows.

External selection validates and renders locally, uploads before page commit,
and persists payload-free immutable assets with authoritative integrity facts.
Failures never silently fall back inline. Docs, changelog, API matrix, and
regression coverage are current.
