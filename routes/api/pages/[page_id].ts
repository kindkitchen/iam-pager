import { app_services } from "../../../lib/app.ts";
import { define } from "../../../utils.ts";

/** Page item route; the adapter validates the URL ID, method, and preconditions. */
export const handler = define.handlers({
  async GET(ctx) {
    return (await app_services()).pages_http.item(
      ctx.req,
      ctx.state.request_context,
    );
  },
  async PATCH(ctx) {
    return (await app_services()).pages_http.item(
      ctx.req,
      ctx.state.request_context,
    );
  },
  async DELETE(ctx) {
    return (await app_services()).pages_http.item(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
