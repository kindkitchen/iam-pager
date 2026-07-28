import {
  map_link_expansion_service,
  map_link_expansion_status,
} from "../../../lib/ui/map-link-expansion.ts";
import { define } from "../../../utils.ts";

/**
 * Expands an official Google short link server-side, since a
 * browser cannot follow that cross-origin redirect. Only URLs the parser
 * classifies as Google short links are ever fetched.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null);
    const result = await map_link_expansion_service.expand(
      (body as { url?: unknown } | null)?.url,
    );
    return Response.json(
      result.ok ? { url: result.url } : { error: result.reason },
      { status: map_link_expansion_status(result) },
    );
  },
});
