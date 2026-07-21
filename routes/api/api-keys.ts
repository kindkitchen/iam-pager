import { define } from "../../utils.ts";
import { app_services } from "../../lib/app.ts";

/** Owner API-key collection; lifecycle rules stay outside Fresh. */
export const handler = define.handlers({
  async GET(ctx) {
    return (await app_services()).api_keys_http.list(
      ctx.req,
      ctx.state.request_context,
    );
  },
  async POST(ctx) {
    return (await app_services()).api_keys_http.create(
      ctx.req,
      ctx.state.request_context,
    );
  },
  async DELETE(ctx) {
    return (await app_services()).api_keys_http.revoke_all(
      ctx.req,
      ctx.state.request_context,
    );
  },
});
