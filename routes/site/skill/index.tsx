import { AgentSkillPage } from "../../../components/AgentSkillPage.tsx";
import { agent_skill_presenter } from "../../../lib/ui/agent-skill.ts";
import { site_breadcrumb_presenter } from "../../../lib/ui/site-breadcrumb.ts";
import { site_navigation_presenter } from "../../../lib/ui/site-navigation.ts";
import { define } from "../../../utils.ts";

/** Human-friendly rendering of the code-owned agent skill. */
export default define.page(function SiteAgentSkill({ state, url }) {
  return (
    <AgentSkillPage
      navigation={site_navigation_presenter.present(
        state.request_context.session,
        url,
      )}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "agent_skill" })}
      skill={agent_skill_presenter.present()}
    />
  );
});
