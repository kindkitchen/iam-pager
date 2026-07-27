---
name: content-locators-delivery
description: One logical content item, many locator references, explicit delivery profiles. Load when changing publication, locator bindings, delivery behavior, or the page API.
updated: 2026-07-21
sources: [decouple-content-locators-delivery]
---

Logical page identity and the immutable current asset are independent of the
URLs that reference them.

- A publication has a non-empty, format-neutral locator-reference set. One
  reference is structurally preferred only for management, exploration, sorting,
  and stable links — never for content identity.
- Additional references may span any namespace the actor has authority over;
  authority is checked per referenced namespace. There is no same-namespace rule
  and no domain reference-count rule.
- Every reference carries a bounded lowercase delivery-profile identifier. Each
  content handler declares the subset it supports. `inline` and `attachment` are
  the profiles the current HTTP transport implements; an unknown future profile
  fails explicitly (`501`) instead of defaulting to attachment.
- PDF follows the same rules as Markdown: any single supported profile, or any
  combination across several references. There is no required inline-canonical
  plus attachment-alternate pair. Markdown is inline-only.
- Content-only replacement preserves references. JSON create/update and
  multipart metadata share one strict endpoint-set decoder; JSON PATCH can
  replace the set; duplication may supply explicit destination references.
- Deno KV's eight-reference atomic commit limit is an adapter capacity reported
  as `endpoint_capacity_exceeded`, not a domain or UI validation rule. The
  memory repository accepts larger request-bounded sets.
