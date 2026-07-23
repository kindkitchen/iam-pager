import { app_services } from "../../../lib/app.ts";
import { define } from "../../../utils.ts";

/** Provider-targeted connect and disconnect lifecycle. */
export const handler = define.handlers({
  async POST(ctx) {
    return await (await app_services()).storage_connections_http.connect(
      ctx.req,
      ctx.state.request_context,
      ctx.params.provider_id,
    );
  },
  async DELETE(ctx) {
    return await (await app_services()).storage_connections_http.disconnect(
      ctx.req,
      ctx.state.request_context,
      ctx.params.provider_id,
    );
  },
});
