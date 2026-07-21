import { NotFoundPage } from "../components/NotFoundPage.tsx";
import { app_services } from "../lib/app.ts";
import {
  deliver_page_locator_path,
  page_actor_from_session,
} from "../lib/page/mod.ts";
import { browser_not_found_response_policy } from "../lib/ui/not-found-response.ts";
import { define } from "../utils.ts";

/** Catch-all direct delivery through the composed page application service. */
export const handler = define.handlers({
  async GET(ctx) {
    const { engine, pages } = await app_services();
    const response = await deliver_page_locator_path(
      engine,
      pages,
      ctx.req,
      page_actor_from_session(ctx.state.request_context.session),
      ctx.state.request_context.request_id,
    );
    if (
      browser_not_found_response_policy.should_render_page(ctx.req, response)
    ) {
      return ctx.render(NotFoundPage(), { status: 404 });
    }
    return response;
  },
});
