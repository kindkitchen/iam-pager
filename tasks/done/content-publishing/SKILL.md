---
name: content-publishing
description: First content publishing slice. Load when reviewing its guest flow.
created: 2026-07-17
updated: 2026-07-18
tags: [backend, frontend, publishing]
relates: []
---

Completed. See [[009.summary]] for the compact implementation record and
[[010.log]] for closure.

The slice provides pluggable locator mapping, `MdPage` publishing over a shared
use-case layer, bounded `POST /api/pages`, a guest site form, and isolated raw
delivery. 72 tests pass; check, production build, and production-server smoke
verification succeeded.

Deferred: durable storage; total capacity, frequency, and expiry policy;
authenticated namespace reservation; full locator character policy; search;
cache validators; additional content types; and external storage.
