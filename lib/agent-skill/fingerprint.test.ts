import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  agent_skill_etag_matches,
  agent_skill_snapshot,
  DigestAgentSkillSnapshotSource,
} from "./fingerprint.ts";
import {
  agent_skill_document,
  type AgentSkillDocument,
  StaticAgentSkillSource,
} from "./skill.ts";

function document(overrides: Partial<AgentSkillDocument>): AgentSkillDocument {
  return { ...agent_skill_document, ...overrides };
}

Deno.test("the tag is stable for identical bytes", async () => {
  const first = await agent_skill_snapshot(agent_skill_document);
  const second = await agent_skill_snapshot(agent_skill_document);
  assertEquals(first.etag, second.etag);
  // A strong entity tag must be quoted for a cache to compare it.
  assert(first.etag.startsWith('"') && first.etag.endsWith('"'));
});

Deno.test("changed skill text invalidates the tag even without a bump", async () => {
  const current = await agent_skill_snapshot(agent_skill_document);
  const edited = await agent_skill_snapshot(
    document({
      markdown: `${agent_skill_document.markdown}\n- one more rule.`,
    }),
  );
  assertNotEquals(current.etag, edited.etag);
  assertEquals(edited.document.version, current.document.version);
});

Deno.test("a version bump alone also invalidates the tag", async () => {
  const current = await agent_skill_snapshot(agent_skill_document);
  const bumped = await agent_skill_snapshot(document({ version: "9.9.9" }));
  assertNotEquals(current.etag, bumped.etag);
  assertEquals(bumped.document.version, "9.9.9");
});

Deno.test("a snapshot always pairs the tag with the bytes it describes", async () => {
  // The route must never read the body and the tag through two paths.
  const other = document({ markdown: "# Other\n", version: "2.0.0" });
  const snapshot = await new DigestAgentSkillSnapshotSource(
    new StaticAgentSkillSource(other),
  ).current();
  assertEquals(snapshot.document.markdown, "# Other\n");
  assertEquals(snapshot.etag, (await agent_skill_snapshot(other)).etag);
  assertNotEquals(
    snapshot.etag,
    (await agent_skill_snapshot(agent_skill_document)).etag,
  );
});

Deno.test("the source computes once and answers the same value", async () => {
  let reads = 0;
  const source = new DigestAgentSkillSnapshotSource({
    document() {
      reads += 1;
      return agent_skill_document;
    },
  });
  const first = await source.current();
  const second = await source.current();
  assertEquals(first.etag, second.etag);
  assertEquals(reads, 1);
});

Deno.test("a failed read is retried instead of memoised forever", async () => {
  let attempts = 0;
  const source = new DigestAgentSkillSnapshotSource({
    document() {
      attempts += 1;
      if (attempts === 1) throw new Error("document unavailable");
      return agent_skill_document;
    },
  });
  // The first call must not poison every later one with its rejection.
  try {
    await source.current();
    throw new Error("expected the first read to fail");
  } catch (error) {
    assertEquals((error as Error).message, "document unavailable");
  }
  assertEquals(
    (await source.current()).etag,
    (await agent_skill_snapshot(agent_skill_document)).etag,
  );
  assertEquals(attempts, 2);
});

Deno.test("conditional matching accepts exact, weak, and wildcard tags", () => {
  const etag = '"skill-1.1.0-abc"';
  assert(agent_skill_etag_matches(etag, etag));
  assert(agent_skill_etag_matches(`W/${etag}`, etag));
  assert(agent_skill_etag_matches("*", etag));
  assert(agent_skill_etag_matches(`"other", ${etag}`, etag));
  assert(!agent_skill_etag_matches(null, etag));
  assert(!agent_skill_etag_matches('"other"', etag));
});
