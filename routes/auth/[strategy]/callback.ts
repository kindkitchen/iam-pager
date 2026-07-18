import { app_services } from "../../../lib/app.ts";
import { define } from "../../../utils.ts";

/** Generic provider callback route; successful rotation is staged centrally. */
export const handler = define.handlers({
  async GET(context) {
    const services = await app_services();
    const result = await services.authentication_http.callback(
      context.req,
      context.params.strategy,
      context.state.request_context,
    );
    if (result.session_resolution !== undefined) {
      services.request_context.apply_session_resolution(
        context.state,
        result.session_resolution,
      );
    }
    return result.response;
  },
});
