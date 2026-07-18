import { define } from "../../utils.ts";
import { app_services } from "../../lib/app.ts";
import { publish_guest_md_page_request } from "../../lib/publishing/mod.ts";

/** Unauthenticated create-or-replace endpoint for the first MdPage flow. */
export const handler = define.handlers({
  async POST(ctx) {
    return publish_guest_md_page_request(
      ctx.req,
      (await app_services()).publishing,
    );
  },
});
