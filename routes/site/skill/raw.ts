import { agent_skill_document } from "../../../lib/agent-skill/skill.ts";
import { agent_skill_media_type } from "../../../lib/ui/agent-skill.ts";
import { define } from "../../../utils.ts";

/** Verbatim skill document, for agents and for a manual copy. */
export const handler = define.handlers({
  GET() {
    return new Response(agent_skill_document.markdown, {
      status: 200,
      headers: {
        "content-type": agent_skill_media_type,
        "content-disposition":
          `inline; filename="${agent_skill_document.file_name}"`,
        "cache-control": "public, max-age=300",
      },
    });
  },
});
