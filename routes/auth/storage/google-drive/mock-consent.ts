import { app_services } from "../../../../lib/app.ts";
import { define } from "../../../../utils.ts";

export const handler = define.handlers({
  async GET(context) {
    return (await app_services()).google_drive_mock_consent_http.handle(
      context.req,
    );
  },
});
