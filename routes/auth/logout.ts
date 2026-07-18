import { app_services } from "../../lib/app.ts";
import { define } from "../../utils.ts";

/** CSRF-protected logout; the lifecycle transition stays outside Fresh. */
export const handler = define.handlers({
  async POST(context) {
    const services = await app_services();
    const result = await services.authentication_http.logout(
      context.req,
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
