import { define } from "../../../utils.ts";
import { MdPageHandler } from "../../../lib/content/md-page.ts";
import { preview_md_page_request } from "../../../lib/ui/page-preview-http.ts";

const md_page_handler = new MdPageHandler();

/** Internal site endpoint keeping the server-only MdPage renderer out of islands. */
export const handler = define.handlers({
  POST(ctx) {
    return preview_md_page_request(ctx.req, md_page_handler);
  },
});
