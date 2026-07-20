import { app_services } from "../../../../lib/app.ts";
import { define } from "../../../../utils.ts";

/** Bulk deletion command route; decoding and authority stay in the adapter. */
export const handler = define.handlers({
  async POST(ctx) {
    return (await app_services()).pages_http.bulk(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
