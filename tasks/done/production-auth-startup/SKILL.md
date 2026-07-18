---
name: production-auth-startup
description: Fixed bundled production authentication startup and configurable server port loading. Load when reviewing built-server startup, runtime environment files, or Google preset bundling.
created: 2026-07-18
updated: 2026-07-18
tags: [authentication, production, build, backend]
relates: [user-authentication]
---

Completed. The SSR build externalizes gauth and Effect together, so both Google
presets start without circular chunk evaluation. The production runner validates
optional `PORT` before loading the generated server and leaves Deno's port-8000
default intact when omitted.

Verified check, 168 tests, build output, invalid-port rejection, explicit/default
ports, and built-server startup in local and original modes. Deployment variables
and generated-entrypoint requirements are documented.
