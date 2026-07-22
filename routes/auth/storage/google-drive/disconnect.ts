import { app_services } from "../../../../lib/app.ts";
import { define } from "../../../../utils.ts";

export const handler = define.handlers({
  async POST(context) {
    return await (await app_services()).google_drive_connections_http
      .disconnect(
        context.req,
        context.state.request_context,
      );
  },
});
