import { app_services } from "../../../../lib/app.ts";
import { define } from "../../../../utils.ts";

/** Rename action route; the adapter validates URL, CSRF, and preconditions. */
export const handler = define.handlers({
  async POST(ctx) {
    return (await app_services()).pages_http.item_action(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
