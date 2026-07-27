import {
  agent_skill_cache_control,
  agent_skill_etag_matches,
  agent_skill_snapshot_source,
  agent_skill_version_header,
} from "../../../lib/agent-skill/fingerprint.ts";
import { agent_skill_media_type } from "../../../lib/ui/agent-skill.ts";
import { define } from "../../../utils.ts";

/**
 * Verbatim skill document, for agents and for a manual copy.
 *
 * Validated rather than time-boxed: the entity tag is derived from the served
 * bytes, so a deploy that changes the skill invalidates every cached copy on
 * its next conditional request instead of after a fixed window. Body and tag
 * come from one snapshot, never from two separate reads.
 */
export const handler = define.handlers({
  async GET(context) {
    const { document, etag } = await agent_skill_snapshot_source.current();
    const headers = new Headers({
      "cache-control": agent_skill_cache_control,
      etag,
      [agent_skill_version_header]: document.version,
    });
    if (
      agent_skill_etag_matches(context.req.headers.get("if-none-match"), etag)
    ) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("content-type", agent_skill_media_type);
    headers.set(
      "content-disposition",
      `inline; filename="${document.file_name}"`,
    );
    return new Response(document.markdown, { status: 200, headers });
  },
});
