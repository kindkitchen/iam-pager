import { app_services } from "../lib/app.ts";
import { define } from "../utils.ts";

/**
 * Root application middleware. Fresh/static assets are served before file
 * routing, so only requests reaching application routing receive this context.
 */
export default define.middleware(async (context) =>
  (await app_services()).request_context.handle(context)
);
