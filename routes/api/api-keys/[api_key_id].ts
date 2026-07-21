import { define } from "../../../utils.ts";
import { app_services } from "../../../lib/app.ts";

/** One owned API key; lifecycle rules stay outside Fresh. */
export const handler = define.handlers({
  async GET(ctx) {
    return (await app_services()).api_keys_http.inspect(
      ctx.req,
      ctx.state.request_context,
      ctx.params.api_key_id,
    );
  },
  async PATCH(ctx) {
    return (await app_services()).api_keys_http.update(
      ctx.req,
      ctx.state.request_context,
      ctx.params.api_key_id,
    );
  },
  async DELETE(ctx) {
    return (await app_services()).api_keys_http.revoke(
      ctx.req,
      ctx.state.request_context,
      ctx.params.api_key_id,
    );
  },
});
