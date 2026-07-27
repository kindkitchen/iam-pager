import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  agent_skill_document,
  type AgentSkillDocument,
  StaticAgentSkillSource,
} from "../agent-skill/skill.ts";
import {
  agent_skill_media_type,
  agent_skill_presenter,
  agent_skill_raw_href,
  DocumentAgentSkillPresenter,
} from "./agent-skill.ts";

Deno.test("the skill teaches credential handling, capabilities, and the lock", () => {
  const markdown = agent_skill_document.markdown;
  assertStringIncludes(markdown, "/site/api-keys");
  assertStringIncludes(markdown, "Authorization: Bearer");
  assertStringIncludes(markdown, "environment variable");
  assertStringIncludes(markdown, "never echo it into logs");
  assertStringIncludes(markdown, "POST /api/pages");
  assertStringIncludes(markdown, "DELETE /api/pages/:page_id");
  assertStringIncludes(markdown, "If-Match");
  assertStringIncludes(markdown, "api_write_blocked");
  assertStringIncludes(markdown, "protection_requires_session");
  // Front matter keeps the document loadable as a skill file, not just prose.
  assert(markdown.startsWith("---\n"));
  assertStringIncludes(markdown, `name: ${agent_skill_document.id}`);
});

Deno.test("the skill teaches non-transactional bulk semantics", () => {
  const markdown = agent_skill_document.markdown;
  assertStringIncludes(markdown, "POST /api/pages/bulk/delete");
  assertStringIncludes(markdown, "expected_revision");
  assertStringIncludes(markdown, "invalid_selection");
  assertStringIncludes(markdown, "revision_conflict");
  assertStringIncludes(markdown, "revision_exhausted");
  // The locked-page answer differs by shape; both must be stated.
  assertStringIncludes(markdown, "1\u2013100");
  assertStringIncludes(
    markdown,
    "never rolls back the items that\n  already succeeded",
  );
  assert(!markdown.includes("presence with a bearer is an error"));
});

Deno.test("the skill presenter projects one document into preview and copy", () => {
  const model = agent_skill_presenter.present();
  assertEquals(model.markdown, agent_skill_document.markdown);
  assertEquals(model.version, agent_skill_document.version);
  assertEquals(model.file_name, agent_skill_document.file_name);
  assertEquals(model.raw_href, agent_skill_raw_href);
  assertEquals(agent_skill_media_type, "text/markdown; charset=utf-8");
  assertEquals(model.blocks[0].kind, "front_matter");
  assert(
    model.blocks.some((block) =>
      block.kind === "heading" && block.level === 1 &&
      block.content.some((run) => run.text === "iam-pager")
    ),
  );
  assert(model.blocks.some((block) => block.kind === "table"));
  assert(model.blocks.some((block) => block.kind === "code"));
  assert(model.usage.length > 0);
});

Deno.test("the presenter renders whichever source it is given", () => {
  const document: AgentSkillDocument = {
    id: "other",
    title: "Other skill",
    version: "9.9.9",
    summary: "Another document entirely.",
    file_name: "other.md",
    markdown: "# Other\n\nBody.\n",
  };
  const model = new DocumentAgentSkillPresenter(
    new StaticAgentSkillSource(document),
  ).present();
  assertEquals(model.title, "Other skill");
  assertEquals(model.markdown, document.markdown);
  assertEquals(model.blocks.length, 2);
});
