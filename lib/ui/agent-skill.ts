import {
  agent_skill_source,
  type AgentSkillDocument,
  type AgentSkillSource,
} from "../agent-skill/skill.ts";
import {
  type MarkdownBlock,
  parse_markdown_blocks,
} from "./markdown-blocks.ts";

/**
 * Server-owned model of the agent-skill destination: the same document twice —
 * once rendered for a human reader, once verbatim for an agent to copy.
 */
export interface AgentSkillPageModel {
  readonly title: string;
  readonly version: string;
  readonly summary: string;
  /** Suggested local file name for the copied skill. */
  readonly file_name: string;
  /** Route serving the document verbatim as `text/markdown`. */
  readonly raw_href: string;
  /** Exact skill text; the copy control must not transform it. */
  readonly markdown: string;
  /** Human-readable projection of the same text, as renderable blocks. */
  readonly blocks: readonly MarkdownBlock[];
  /** Short human framing above the preview; copy only, never logic. */
  readonly usage: readonly string[];
}

export interface AgentSkillPresenter {
  present(): AgentSkillPageModel;
}

/** Canonical location of the verbatim document. */
export const agent_skill_raw_href = "/site/skill/raw";

/** Media type the raw route answers with. */
export const agent_skill_media_type = "text/markdown; charset=utf-8";

/**
 * Renders the code-owned document. Nothing here decides skill content: the
 * presenter only projects one `AgentSkillSource` into a page model.
 */
export class DocumentAgentSkillPresenter implements AgentSkillPresenter {
  readonly #source: AgentSkillSource;

  constructor(source: AgentSkillSource = agent_skill_source) {
    this.#source = source;
  }

  present(): AgentSkillPageModel {
    const document: AgentSkillDocument = this.#source.document();
    return {
      title: document.title,
      version: document.version,
      summary: document.summary,
      file_name: document.file_name,
      raw_href: agent_skill_raw_href,
      markdown: document.markdown,
      blocks: parse_markdown_blocks(document.markdown),
      usage: [
        `Copy the raw document into your agent's skill directory as ${document.file_name}, or point the agent at ${agent_skill_raw_href}.`,
        "The agent still needs a credential: issue an API key with the narrowest permissions the job needs, and give the agent the key through your secret store — not through the chat.",
        "Any page you switch to “Block API writes” in page management stays untouchable for every key, including the one your agent holds.",
      ],
    };
  }
}

export const agent_skill_presenter: AgentSkillPresenter =
  new DocumentAgentSkillPresenter();
