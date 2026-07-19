import { define } from "../../utils.ts";
import { app_services } from "../../lib/app.ts";
import {
  publish_actor_from_session,
  publish_guest_md_page_request,
} from "../../lib/publishing/mod.ts";

/** Create-or-replace endpoint for the first MdPage flow; guests welcome. */
export const handler = define.handlers({
  async POST(ctx) {
    return publish_guest_md_page_request(
      ctx.req,
      (await app_services()).publishing,
      publish_actor_from_session(ctx.state.request_context.session),
    );
  },
});
