import { app_services } from "../../../lib/app.ts";
import { define } from "../../../utils.ts";

/** Generic provider start route; provider behavior stays behind its strategy. */
export const handler = define.handlers({
  async GET(context) {
    const services = await app_services();
    const result = await services.authentication_http.start(
      context.req,
      context.params.strategy,
      context.state.request_context,
    );
    return result.response;
  },
});
