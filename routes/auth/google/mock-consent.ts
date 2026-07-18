import { app_services } from "../../../lib/app.ts";
import { define } from "../../../utils.ts";

/** Available only when startup explicitly selects loopback local Google auth. */
export const handler = define.handlers({
  async GET(context) {
    return (await app_services()).google_mock_consent_http.handle(context.req);
  },
});
