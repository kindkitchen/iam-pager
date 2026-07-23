import { app_services } from "../../lib/app.ts";
import { define } from "../../utils.ts";

/** Owner-safe storage-connection collection. */
export const handler = define.handlers({
  async GET(ctx) {
    return await (await app_services()).storage_connections_http.list(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
