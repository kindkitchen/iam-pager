import { app_services } from "../../lib/app.ts";
import { define } from "../../utils.ts";

/** Page collection route; decoding and authority stay in the raw HTTP adapter. */
export const handler = define.handlers({
  async GET(ctx) {
    return (await app_services()).pages_http.collection(
      ctx.req,
      ctx.state.request_context,
    );
  },
  async POST(ctx) {
    return (await app_services()).pages_http.collection(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
