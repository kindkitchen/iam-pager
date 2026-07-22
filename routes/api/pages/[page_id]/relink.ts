import { app_services } from "../../../../lib/app.ts";
import { define } from "../../../../utils.ts";

/** Revision-bound repair of an external page reference. */
export const handler = define.handlers({
  async POST(ctx) {
    return (await app_services()).pages_http.item_action(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
