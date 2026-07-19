import { define } from "../../utils.ts";
import { app_services } from "../../lib/app.ts";

/** Authenticated namespace reservation API; rules stay outside Fresh. */
export const handler = define.handlers({
  async GET(ctx) {
    return (await app_services()).namespaces_http.list_owned(
      ctx.req,
      ctx.state.request_context,
    );
  },
  async POST(ctx) {
    return (await app_services()).namespaces_http.reserve(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
