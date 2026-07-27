import AgentSkillCopy from "../islands/AgentSkillCopy.tsx";
import { MarkdownDocument } from "./MarkdownDocument.tsx";
import type { AgentSkillPageModel } from "../lib/ui/agent-skill.ts";
import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";
import type { SiteNavigation } from "../lib/ui/site-navigation.ts";
import { SitePageHeader } from "./SiteNavigation.tsx";

export interface AgentSkillPageProps {
  readonly navigation: SiteNavigation;
  readonly breadcrumb: SiteBreadcrumbTrail;
  readonly skill: AgentSkillPageModel;
}

/** Human-readable projection of the agent skill, plus the verbatim copy. */
export function AgentSkillPage(
  { navigation, breadcrumb, skill }: AgentSkillPageProps,
) {
  return (
    <main class="site-app agent-skill-shell">
      <SitePageHeader
        navigation={navigation}
        breadcrumb={breadcrumb}
        eyebrow={`Agent skill · v${skill.version}`}
        title={skill.title}
        intro={skill.summary}
      />

      <section class="agent-skill-usage">
        <h2>How to use it</h2>
        <ul>
          {skill.usage.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p class="agent-skill-usage-links">
          <a href="/site/api-keys">Issue an API key</a>
          <a href="/site/manage">Manage pages and API locks</a>
        </p>
      </section>

      <AgentSkillCopy
        markdown={skill.markdown}
        file_name={skill.file_name}
        raw_href={skill.raw_href}
      />

      <MarkdownDocument blocks={skill.blocks} class="agent-skill-preview" />
    </main>
  );
}
