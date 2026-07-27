import { assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { AgentSkillPage } from "../../components/AgentSkillPage.tsx";
import { agent_skill_presenter } from "./agent-skill.ts";
import { site_breadcrumb_presenter } from "./site-breadcrumb.ts";
import { site_navigation_presenter } from "./site-navigation.ts";

const guest_session = {
  kind: "guest",
  session_id: "guest-session",
  session_version: 1,
  created_at: new Date("2026-07-20T01:00:00.000Z"),
  last_seen_at: new Date("2026-07-20T01:00:00.000Z"),
  absolute_expires_at: new Date("2026-07-27T01:00:00.000Z"),
} as const;

Deno.test("agent skill page renders the preview and an explicit copy control", () => {
  const html = render_to_string(
    <AgentSkillPage
      navigation={site_navigation_presenter.present(
        guest_session,
        new URL("https://pager.test/site/skill"),
      )}
      breadcrumb={site_breadcrumb_presenter.present({ kind: "agent_skill" })}
      skill={agent_skill_presenter.present()}
    />,
  );

  assertStringIncludes(html, "Copy raw skill");
  assertStringIncludes(html, 'href="/site/skill/raw"');
  assertStringIncludes(html, "iam-pager-skill.md");
  assertStringIncludes(html, "agent-skill-preview");
  assertStringIncludes(html, "<h2>3. Capabilities</h2>");
  assertStringIncludes(html, "<table>");
  assertStringIncludes(html, "Agent skill");
  assertStringIncludes(html, "Block API writes");
});
