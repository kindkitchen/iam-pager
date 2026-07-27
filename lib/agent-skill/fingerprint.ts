/**
 * Cache validation for the code-owned agent skill.
 *
 * The document ships inside the server binary, so "the deploy changed" and
 * "the bytes changed" are the same event. A validator derived from those bytes
 * therefore needs no build step, no manual version bump, and no purge hook: a
 * deploy that alters the text alters the tag, and every cached copy revalidates
 * into the new one on its next conditional request.
 */

import {
  agent_skill_source,
  type AgentSkillDocument,
  type AgentSkillSource,
} from "./skill.ts";

/**
 * One document together with the tag for exactly its bytes.
 *
 * Body and validator travel as one value on purpose. Reading the document and
 * computing its tag through two independent paths is how a cache gets poisoned:
 * clients would store body A under tag B and then revalidate A forever.
 */
export interface AgentSkillSnapshot {
  readonly document: AgentSkillDocument;
  /** Strong HTTP entity tag for `document.markdown`, already quoted. */
  readonly etag: string;
}

/** Any source able to answer "which bytes are you serving, and under which tag". */
export interface AgentSkillSnapshotSource {
  current(): Promise<AgentSkillSnapshot>;
}

/** Bytes of the digest kept in the tag. */
const digest_bytes = 18;

/**
 * Derives the tag from the exact bytes rather than from `version`, so an edit
 * that forgets the version bump still invalidates every cached copy. The
 * version stays in the tag as a readable prefix only.
 */
export async function agent_skill_snapshot(
  document: AgentSkillDocument,
): Promise<AgentSkillSnapshot> {
  const input = new TextEncoder().encode(document.markdown);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  let binary = "";
  for (const byte of digest.subarray(0, digest_bytes)) {
    binary += String.fromCharCode(byte);
  }
  const opaque = btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
  return { document, etag: `"skill-${document.version}-${opaque}"` };
}

/**
 * Computes once per process. A process only ever holds one document, so the
 * memo cannot go stale: a new document means a new deploy means a new process.
 * A failed digest is not memoised, or one transient fault would answer every
 * later request from the same rejected promise.
 */
export class DigestAgentSkillSnapshotSource
  implements AgentSkillSnapshotSource {
  readonly #source: AgentSkillSource;
  #memo: Promise<AgentSkillSnapshot> | null = null;

  constructor(source: AgentSkillSource = agent_skill_source) {
    this.#source = source;
  }

  current(): Promise<AgentSkillSnapshot> {
    if (this.#memo === null) {
      const pending = agent_skill_snapshot(this.#source.document());
      this.#memo = pending;
      pending.catch(() => {
        if (this.#memo === pending) this.#memo = null;
      });
    }
    return this.#memo;
  }
}

/**
 * Does an `If-None-Match` header claim this exact entity? Accepts the wildcard
 * and the weak form, because a cache is free to weaken a strong tag.
 */
export function agent_skill_etag_matches(
  header: string | null,
  etag: string,
): boolean {
  if (header === null) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}

/**
 * `no-cache` is "store it, but ask before reusing it": clients keep the bytes
 * and spend one conditional request per use, which answers `304` with no body
 * until a deploy changes the tag.
 *
 * This trades requests for correctness, and the trade is only defensible
 * because the route is tiny and rarely called. It does not save a round trip or
 * a server invocation — only the body. A `max-age` window would save the whole
 * request at the cost of serving known-superseded instructions for its length;
 * if this route ever becomes hot, that is the knob to turn, and the tag below
 * makes the revalidation after it cheap either way.
 */
export const agent_skill_cache_control = "public, no-cache";

/** Header carrying the declared version, so a consumer can compare cheaply. */
export const agent_skill_version_header = "x-skill-version";

export const agent_skill_snapshot_source: AgentSkillSnapshotSource =
  new DigestAgentSkillSnapshotSource();
