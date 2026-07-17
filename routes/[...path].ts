import { define } from "../utils.ts";
import { app_services } from "../lib/app.ts";
import { deliver_locator_path } from "../lib/publishing/mod.ts";

/**
 * Catch-all raw delivery (CP-DELIVERY): any path not claimed by a more
 * specific route is treated as a locator and answered with raw content.
 * All mapping logic lives in `lib/publishing/http.ts`.
 */
export const handler = define.handlers({
  GET(ctx) {
    const { engine, publishing } = app_services();
    return deliver_locator_path(engine, publishing, ctx.url.pathname);
  },
});
