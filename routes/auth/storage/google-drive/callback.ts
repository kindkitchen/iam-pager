import { app_services } from "../../../../lib/app.ts";
import { define } from "../../../../utils.ts";

export const handler = define.handlers({
  async GET(context) {
    return await (await app_services()).google_drive_connections_http.callback(
      context.req,
      context.state.request_context,
    );
  },
});
