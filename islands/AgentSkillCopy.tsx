import { useState } from "preact/hooks";

export interface AgentSkillCopyProps {
  /** Exact document text; it is copied verbatim, never reformatted. */
  readonly markdown: string;
  readonly file_name: string;
  readonly raw_href: string;
}

type CopyState = "idle" | "copied" | "failed";

/** Explicit copy affordance for the raw skill, with a no-clipboard fallback. */
export default function AgentSkillCopy(props: AgentSkillCopyProps) {
  const [state, set_state] = useState<CopyState>("idle");
  const [revealed, set_revealed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.markdown);
      set_state("copied");
    } catch {
      set_state("failed");
      set_revealed(true);
    }
  }

  return (
    <section class="agent-skill-copy">
      <div class="agent-skill-copy-actions">
        <button type="button" class="agent-skill-copy-button" onClick={copy}>
          Copy raw skill
        </button>
        <a class="agent-skill-copy-link" href={props.raw_href}>
          Open raw markdown
        </a>
        <button
          type="button"
          class="agent-skill-copy-reveal"
          onClick={() => set_revealed(!revealed)}
        >
          {revealed ? "Hide raw text" : "Show raw text"}
        </button>
        <span class="agent-skill-copy-file">{props.file_name}</span>
      </div>

      <p class="agent-skill-copy-status" role="status">
        {state === "copied"
          ? "Raw skill copied to the clipboard."
          : state === "failed"
          ? "Clipboard was refused; select the text below and copy it manually."
          : "The copy is the exact document — no rendering, no truncation."}
      </p>

      {revealed && (
        <textarea
          class="agent-skill-copy-raw"
          readOnly
          rows={18}
          aria-label="Raw agent skill"
          value={props.markdown}
        />
      )}
    </section>
  );
}
