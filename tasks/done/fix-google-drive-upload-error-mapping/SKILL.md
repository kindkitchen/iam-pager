---
name: fix-google-drive-upload-error-mapping
description: Fixed Google Drive publication uploads being reported as missing external files. Load when reviewing Drive upload failure classification or production setup.
created: 2026-07-23
updated: 2026-07-23
tags: [external-storage, google-drive]
relates: []
---
Drive existing-file denial remains non-disclosing and missing, while upload 403 rejection now follows provider unavailability semantics.
Production setup explicitly requires the Google Drive API to be enabled in the OAuth client project.
Regression coverage passes; full verification completed with 671 tests.
