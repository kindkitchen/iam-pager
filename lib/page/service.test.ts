import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { type MdPageData, MdPageHandler } from "../content/md-page.ts";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import type { RandomNameGenerator } from "../random-name.ts";
import {
  max_bulk_managed_pages,
  type PageClock,
  type PageIdGenerator,
} from "./interfaces.ts";
import { MemoryPageRepository } from "./memory-repository.ts";
import { RepositoryNamespaceAuthorityResolver } from "./namespace-authority.ts";
import { make_page_content } from "./repository-conformance.ts";
import { PageService } from "./service.ts";

const guest = { kind: "guest" } as const;
const owner = { kind: "user", user_id: "owner-1" } as const;
const other = { kind: "user", user_id: "other-1" } as const;
const t1 = new Date("2026-07-19T10:00:00.000Z");
const t2 = new Date("2026-07-19T11:00:00.000Z");
const t3 = new Date("2026-07-19T12:00:00.000Z");

class SequenceIds implements PageIdGenerator {
  #ids: string[];
  #fallback = 0;

  constructor(ids: string[] = []) {
    this.#ids = [...ids];
  }

  generate(): string {
    return this.#ids.shift() ?? `generated-${++this.#fallback}`;
  }
}

class SequenceNames implements RandomNameGenerator {
  #names: string[];
  #fallback = 0;

  constructor(names: string[] = []) {
    this.#names = [...names];
  }

  generate(): string {
    return this.#names.shift() ?? `generated-name-${++this.#fallback}`;
  }
}

class SequenceClock implements PageClock {
  #dates: Date[];

  constructor(dates: Date[] = [t1]) {
    this.#dates = [...dates];
  }

  now(): Date {
    return new Date(this.#dates.shift() ?? t3);
  }
}

async function make_fixture(options: {
  ids?: string[];
  dates?: Date[];
  max_page_id_attempts?: number;
  names?: string[];
  max_page_name_attempts?: number;
} = {}) {
  const repository = new MemoryPageRepository();
  const namespaces = new MemoryNamespaceRepository();
  await namespaces.reserve({ namespace: "Mine", owner_user_id: owner.user_id });
  await namespaces.reserve({
    namespace: "Theirs",
    owner_user_id: other.user_id,
  });
  const service = new PageService({
    engine: new LocatorEngine({
      strategies: [new PathSlugStrategy()],
      forbidden_namespaces: ["site", "api", "auth"],
    }),
    repository,
    namespace_authority: new RepositoryNamespaceAuthorityResolver(namespaces),
    handlers: [new MdPageHandler()],
    page_id_generator: new SequenceIds(options.ids),
    clock: new SequenceClock(options.dates),
    max_page_id_attempts: options.max_page_id_attempts,
    page_name_generator: new SequenceNames(options.names),
    max_page_name_attempts: options.max_page_name_attempts,
  });
  return { service, repository, namespaces };
}

function trial_request(namespace = "free", md = "# Trial") {
  return {
    actor: guest,
    locator: { namespace },
    access: "public" as const,
    content: { content_type: "md-page", input: { md } },
  };
}

function managed_request(
  page_name: string | undefined = "notes",
  access: "public" | "private" = "private",
  md = "# Managed",
) {
  return {
    actor: owner,
    locator: page_name === undefined
      ? { namespace: "Mine" }
      : { namespace: "Mine", page_name },
    access,
    content: { content_type: "md-page", input: { md } },
  };
}

Deno.test("PageService trial publish creates and replaces complete public content", async () => {
  const { service, repository } = await make_fixture({
    ids: ["trial-1", "unused-on-replace"],
    dates: [t1, t2],
  });
  const first = await service.publish_trial(trial_request("Free", "# One"));
  const second = await service.publish_trial(trial_request("FREE", "# Two"));
  assert(first.ok && second.ok);
  assertEquals(first.outcome, "created");
  assertEquals(second.outcome, "replaced");
  assertEquals(second.page.page_id, first.page.page_id);
  assertEquals(second.page.revision, 2);
  assertEquals(second.page.created_at, t1);
  assertEquals(second.page.updated_at, t2);
  assertEquals(second.page.path, "/FREE");

  const stored = await repository.find_by_id(first.page.page_id);
  assert(stored !== null);
  const payload = new MdPageHandler().render(stored.content.data as MdPageData);
  assertEquals(stored.content.meta.media_type, payload.media_type);
  assertEquals(
    stored.content.meta.size_bytes,
    new TextEncoder().encode(payload.body as string).byteLength,
  );
  assertFalse((stored.content.data as MdPageData).html.includes("<script>"));
});

Deno.test("PageService trial publish rejects private, reserved, forbidden, and invalid requests", async () => {
  const { service } = await make_fixture();
  assertEquals(
    await service.publish_trial({
      ...trial_request(),
      access: "private",
    }),
    { ok: false, reason: "private_requires_managed_page" },
  );
  assertEquals(await service.publish_trial(trial_request("MINE")), {
    ok: false,
    reason: "namespace_reserved",
  });
  assertEquals(await service.publish_trial(trial_request("site")), {
    ok: false,
    reason: "forbidden_namespace",
  });
  assertEquals(
    await service.publish_trial({
      ...trial_request(),
      locator: { namespace: "free", page_name: "" },
    }),
    { ok: false, reason: "invalid_locator" },
  );
  const invalid = await service.publish_trial(trial_request("free", ""));
  assertFalse(invalid.ok);
  assertEquals(invalid.reason, "invalid_input");
});

Deno.test("PageService managed create requires exact current namespace authority", async () => {
  const { service } = await make_fixture();
  assertEquals(
    await service.create_managed({
      ...managed_request(),
      locator: { namespace: "free" },
    }),
    { ok: false, reason: "namespace_not_reserved" },
  );
  assertEquals(
    await service.create_managed({
      ...managed_request(),
      locator: { namespace: "Theirs" },
    }),
    { ok: false, reason: "namespace_reserved" },
  );
  const created = await service.create_managed(managed_request());
  assert(created.ok);
  assertEquals(created.outcome, "created");
  assertEquals(created.page.access, "private");
  assertEquals(created.page.revision, 1);
});

Deno.test("PageService normalizes bounded tags and supports tag-only updates", async () => {
  const { service, repository } = await make_fixture({
    ids: ["tagged"],
    dates: [t1, t2],
  });
  const created = await service.create_managed({
    ...managed_request(),
    tags: [" News ", "deno", "news"],
  });
  assert(created.ok);
  assertEquals(created.page.tags, ["deno", "news"]);
  assertEquals((await repository.find_by_id("tagged"))?.tags, [
    "deno",
    "news",
  ]);

  const updated = await service.update_managed({
    actor: owner,
    page_id: created.page.page_id,
    expected_revision: 1,
    patch: { tags: [" Archive "] },
  });
  assert(updated.ok);
  assertEquals(updated.page.tags, ["archive"]);
  assertEquals(updated.page.revision, 2);

  assertEquals(
    await service.create_managed({
      ...managed_request("invalid"),
      tags: ["bad tag!"],
    }),
    { ok: false, reason: "invalid_tags" },
  );
  assertEquals(
    await service.update_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 2,
      patch: { tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`) },
    }),
    { ok: false, reason: "invalid_tags" },
  );
});

Deno.test("PageService managed create atomically replaces trial but not managed content", async () => {
  const { service, repository } = await make_fixture({
    ids: ["managed-1", "managed-2"],
  });
  await repository.put_trial({
    page_id: "old-trial",
    locator: { namespace: "Mine", page_name: "notes" },
    content: make_page_content("trial"),
    now: t1,
  });
  const replaced = await service.create_managed(managed_request());
  assert(replaced.ok);
  assertEquals(replaced.outcome, "replaced_trial");
  assertEquals(await repository.find_by_id("old-trial"), null);

  const conflict = await service.create_managed({
    ...managed_request(),
    content: { content_type: "md-page", input: { md: "intruder" } },
  });
  assertEquals(conflict, { ok: false, reason: "page_exists" });
  const winner = await repository.find_by_id(replaced.page.page_id);
  assertEquals((winner?.content.data as MdPageData).md, "# Managed");
});

Deno.test("PageService list is owner-only, ordered, paginated, and source-free", async () => {
  const { service } = await make_fixture({
    ids: ["named", "default", "other"],
  });
  const named = await service.create_managed(managed_request("z"));
  const default_page = await service.create_managed(managed_request(undefined));
  assert(named.ok && default_page.ok);

  const first = await service.list_managed({ actor: owner, limit: 1 });
  assert(first.ok);
  assertEquals(first.pages.map((page) => page.page_id), [
    default_page.page.page_id,
  ]);
  assert(first.next_cursor !== null);
  assertEquals("content" in first.pages[0], false);
  assertEquals("stewardship" in first.pages[0], false);

  const second = await service.list_managed({
    actor: owner,
    limit: 10,
    cursor: first.next_cursor,
  });
  assert(second.ok);
  assertEquals(second.pages.map((page) => page.page_id), [named.page.page_id]);

  const empty_other = await service.list_managed({ actor: other, limit: 10 });
  assert(empty_other.ok);
  assertEquals(empty_other.pages, []);
});

Deno.test("PageService namespace-filtered list validates filter, ownership, and cursor", async () => {
  const { service } = await make_fixture({ ids: ["one"] });
  await service.create_managed(managed_request());
  const owned = await service.list_managed({
    actor: owner,
    namespace: "MINE",
    limit: 10,
  });
  assert(owned.ok);
  assertEquals(owned.pages.length, 1);
  assertEquals(
    await service.list_managed({ actor: owner, namespace: "free", limit: 10 }),
    { ok: false, reason: "namespace_not_owned" },
  );
  assertEquals(
    await service.list_managed({ actor: owner, namespace: "a/b", limit: 10 }),
    { ok: false, reason: "invalid_namespace" },
  );
  assertEquals(
    await service.list_managed({ actor: owner, limit: 10, cursor: "bad" }),
    { ok: false, reason: "invalid_cursor" },
  );
});

Deno.test("PageService managed list AND-filters normalized name, access, and tag", async () => {
  const { service } = await make_fixture({
    ids: ["public-release", "private-release", "public-other"],
  });
  await service.create_managed({
    ...managed_request("release-notes", "public"),
    tags: ["Deno", "News"],
  });
  await service.create_managed({
    ...managed_request("release-draft", "private"),
    tags: ["deno"],
  });
  await service.create_managed({
    ...managed_request("other", "public"),
    tags: ["deno"],
  });

  const listed = await service.list_managed({
    actor: owner,
    page_name_query: " RELEASE ",
    access: "public",
    tag: " DENO ",
    limit: 10,
  });
  assert(listed.ok);
  assertEquals(listed.pages.map((page) => page.page_id), ["public-release"]);
  assertEquals(
    await service.list_managed({
      actor: owner,
      page_name_query: "x".repeat(101),
      limit: 10,
    }),
    { ok: false, reason: "invalid_filter" },
  );
  assertEquals(
    await service.list_managed({ actor: owner, tag: "bad tag!", limit: 10 }),
    { ok: false, reason: "invalid_filter" },
  );
});

Deno.test("PageService inspect returns editable source without owner or derivation", async () => {
  const { service } = await make_fixture({ ids: ["managed-1"] });
  const created = await service.create_managed({
    ...managed_request(),
    content: {
      content_type: "md-page",
      input: { md: "# Source", css: "body { color: navy; }" },
    },
  });
  assert(created.ok);
  const inspected = await service.inspect_managed({
    actor: owner,
    page_id: created.page.page_id,
  });
  assert(inspected.ok);
  assertEquals(inspected.page.content, {
    content_type: "md-page",
    input: { md: "# Source", css: "body { color: navy; }" },
  });
  assertEquals("stewardship" in inspected.page, false);
  assertEquals("html" in (inspected.page.content.input as object), false);
  assertEquals(
    await service.inspect_managed({
      actor: other,
      page_id: created.page.page_id,
    }),
    { ok: false, reason: "not_found" },
  );
});

Deno.test("PageService inspect fails closed when current namespace authority is absent", async () => {
  const { service, repository } = await make_fixture();
  await repository.create_managed({
    page_id: "orphaned-authority",
    locator: { namespace: "Unreserved" },
    owner_user_id: owner.user_id,
    access: "public",
    content: make_page_content("stored"),
    now: t1,
  });
  assertEquals(
    await service.inspect_managed({
      actor: owner,
      page_id: "orphaned-authority",
    }),
    { ok: false, reason: "not_found" },
  );
});

Deno.test("PageService access-only and combined updates preserve atomic page invariants", async () => {
  const { service, repository } = await make_fixture({
    ids: ["managed-1"],
    dates: [t1, t2, t3],
  });
  const created = await service.create_managed(
    managed_request("notes", "public"),
  );
  assert(created.ok);
  const before = await repository.find_by_id(created.page.page_id);
  assert(before !== null);

  const access_only = await service.update_managed({
    actor: owner,
    page_id: created.page.page_id,
    expected_revision: 1,
    patch: { access: "private" },
  });
  assert(access_only.ok);
  assertEquals(access_only.page.revision, 2);
  const after_access = await repository.find_by_id(created.page.page_id);
  assertEquals(after_access?.content, before.content);
  assertEquals(after_access?.created_at, t1);
  assertEquals(after_access?.updated_at, t2);

  const combined = await service.update_managed({
    actor: owner,
    page_id: created.page.page_id,
    expected_revision: 2,
    patch: {
      access: "public",
      content: { content_type: "md-page", input: { md: "# Replaced" } },
    },
  });
  assert(combined.ok);
  assertEquals(combined.page.revision, 3);
  assertEquals(combined.page.access, "public");
  assertEquals(combined.page.content.input, { md: "# Replaced" });
});

Deno.test("PageService update rejects empty, invalid, stale, and foreign mutations", async () => {
  const { service } = await make_fixture({ ids: ["managed-1"] });
  const created = await service.create_managed(managed_request());
  assert(created.ok);
  assertEquals(
    await service.update_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 1,
      patch: {},
    }),
    { ok: false, reason: "empty_patch" },
  );
  const invalid = await service.update_managed({
    actor: owner,
    page_id: created.page.page_id,
    expected_revision: 1,
    patch: { content: { content_type: "md-page", input: { md: "" } } },
  });
  assertFalse(invalid.ok);
  assertEquals(invalid.reason, "invalid_input");
  assertEquals(
    await service.update_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 2,
      patch: { access: "public" },
    }),
    { ok: false, reason: "revision_conflict" },
  );
  assertEquals(
    await service.update_managed({
      actor: other,
      page_id: created.page.page_id,
      expected_revision: 1,
      patch: { access: "public" },
    }),
    { ok: false, reason: "not_found" },
  );
});

Deno.test("PageService concurrent updates with one revision have exactly one winner", async () => {
  const { service } = await make_fixture({ ids: ["managed-1"] });
  const created = await service.create_managed(managed_request());
  assert(created.ok);
  const results = await Promise.all([
    service.update_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 1,
      patch: { access: "public" },
    }),
    service.update_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 1,
      patch: {
        content: { content_type: "md-page", input: { md: "# Winner" } },
      },
    }),
  ]);
  assertEquals(results.filter((result) => result.ok).length, 1);
  assertEquals(
    results.filter((result) => !result.ok).map((result) => result.reason),
    ["revision_conflict"],
  );
});

Deno.test("PageService rename validates, conflicts safely, and can set the default page", async () => {
  const { service, repository } = await make_fixture({
    ids: ["source", "protected"],
    dates: [t1, t2, t3],
  });
  const source = await service.create_managed(
    managed_request("notes", "public", "# Source"),
  );
  const protected_page = await service.create_managed(
    managed_request("protected", "private", "# Protected"),
  );
  assert(source.ok && protected_page.ok);

  assertEquals(
    await service.rename_managed({
      actor: owner,
      page_id: source.page.page_id,
      expected_revision: 1,
      page_name: "",
    }),
    { ok: false, reason: "invalid_page_name" },
  );
  const renamed = await service.rename_managed({
    actor: owner,
    page_id: source.page.page_id,
    expected_revision: 1,
    page_name: "Reports/Today",
  });
  assert(renamed.ok);
  assertEquals(renamed.outcome, "renamed");
  assertEquals(renamed.page.path, "/Mine/Reports/Today");
  assertEquals(renamed.page.revision, 2);
  assertEquals(renamed.page.content.input, { md: "# Source" });
  assertEquals(
    await repository.find_by_locator({ namespace: "Mine", page_name: "notes" }),
    null,
  );

  const unchanged = await service.rename_managed({
    actor: owner,
    page_id: source.page.page_id,
    expected_revision: 2,
    page_name: "Reports/Today",
  });
  assert(unchanged.ok);
  assertEquals(unchanged.outcome, "unchanged");
  assertEquals(unchanged.page.revision, 2);
  assertEquals(
    await service.rename_managed({
      actor: owner,
      page_id: source.page.page_id,
      expected_revision: 2,
      page_name: "protected",
    }),
    { ok: false, reason: "page_exists" },
  );

  const made_default = await service.rename_managed({
    actor: owner,
    page_id: source.page.page_id,
    expected_revision: 2,
  });
  assert(made_default.ok);
  assertEquals(made_default.page.path, "/Mine");
  assertEquals(made_default.page.revision, 3);
  assertEquals((await repository.find_by_id("protected"))?.revision, 1);
});

Deno.test("PageService rename remains revision-bound and owner-nondisclosing", async () => {
  const { service } = await make_fixture({ ids: ["managed-1"] });
  const created = await service.create_managed(managed_request());
  assert(created.ok);
  assertEquals(
    await service.rename_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 2,
      page_name: "moved",
    }),
    { ok: false, reason: "revision_conflict" },
  );
  assertEquals(
    await service.rename_managed({
      actor: other,
      page_id: created.page.page_id,
      expected_revision: 1,
      page_name: "moved",
    }),
    { ok: false, reason: "not_found" },
  );
});

Deno.test("PageService duplicate retries generated names and preserves the source snapshot", async () => {
  const { service, repository } = await make_fixture({
    ids: ["source", "protected", "discarded-id", "copy"],
    names: ["protected", "generated-name"],
    dates: [t1, t2, t3],
  });
  const source = await service.create_managed({
    ...managed_request("notes", "private"),
    tags: ["draft", "reference"],
    content: {
      content_type: "md-page",
      input: { md: "# Source", css: "body { color: navy; }" },
    },
  });
  const protected_page = await service.create_managed(
    managed_request("protected", "public", "# Protected"),
  );
  assert(source.ok && protected_page.ok);

  const duplicated = await service.duplicate_managed({
    actor: owner,
    page_id: source.page.page_id,
    expected_revision: 1,
  });
  assert(duplicated.ok);
  assertEquals(duplicated.outcome, "created");
  assertEquals(duplicated.page.page_id, "copy");
  assertEquals(duplicated.page.path, "/Mine/generated-name");
  assertEquals(duplicated.page.access, "private");
  assertEquals(duplicated.page.tags, ["draft", "reference"]);
  assertEquals(duplicated.page.revision, 1);
  assertEquals(duplicated.page.created_at, t3);
  assertEquals(duplicated.page.updated_at, t3);
  assertEquals(duplicated.page.content.input, {
    md: "# Source",
    css: "body { color: navy; }",
  });
  assertEquals((await repository.find_by_id("source"))?.revision, 1);
  assertEquals((await repository.find_by_id("protected"))?.revision, 1);
});

Deno.test("PageService duplicate retries id collisions and bounds name exhaustion", async () => {
  const id_fixture = await make_fixture({
    ids: ["source", "source", "copy"],
    names: ["generated"],
    max_page_id_attempts: 2,
  });
  const source = await id_fixture.service.create_managed(managed_request());
  assert(source.ok);
  const retried = await id_fixture.service.duplicate_managed({
    actor: owner,
    page_id: source.page.page_id,
    expected_revision: 1,
  });
  assert(retried.ok);
  assertEquals(retried.page.page_id, "copy");

  const exhausted = await make_fixture({
    ids: ["source", "one", "two", "attempt-1", "attempt-2"],
    names: ["one", "two"],
    max_page_name_attempts: 2,
  });
  const exhausted_source = await exhausted.service.create_managed(
    managed_request("source"),
  );
  await exhausted.service.create_managed(managed_request("one"));
  await exhausted.service.create_managed(managed_request("two"));
  assert(exhausted_source.ok);
  assertEquals(
    await exhausted.service.duplicate_managed({
      actor: owner,
      page_id: exhausted_source.page.page_id,
      expected_revision: 1,
    }),
    { ok: false, reason: "page_name_generation_exhausted" },
  );
});

Deno.test("PageService delete is revision-bound and removes management and delivery", async () => {
  const { service } = await make_fixture({ ids: ["managed-1"] });
  const created = await service.create_managed(
    managed_request("notes", "public"),
  );
  assert(created.ok);
  assertEquals(
    await service.delete_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 2,
    }),
    { ok: false, reason: "revision_conflict" },
  );
  assertEquals(
    await service.delete_managed({
      actor: other,
      page_id: created.page.page_id,
      expected_revision: 1,
    }),
    { ok: false, reason: "not_found" },
  );
  assertEquals(
    await service.delete_managed({
      actor: owner,
      page_id: created.page.page_id,
      expected_revision: 1,
    }),
    { ok: true },
  );
  assertEquals(
    await service.deliver({ namespace: "Mine", page_name: "notes" }, guest),
    { ok: false, reason: "not_found" },
  );
});

Deno.test("PageService bulk access prevalidates a bounded selection and returns ordered per-page results", async () => {
  const { service, repository } = await make_fixture({
    ids: ["change-one", "change-two", "keep-stale"],
    dates: [t1, t1, t1, t2],
  });
  const one = await service.create_managed({
    ...managed_request("one", "private"),
    tags: ["keep"],
  });
  const two = await service.create_managed(managed_request("two", "private"));
  const stale = await service.create_managed(
    managed_request("stale", "private"),
  );
  assert(one.ok && two.ok && stale.ok);
  await repository.create_managed({
    page_id: "foreign",
    locator: { namespace: "Theirs", page_name: "foreign" },
    owner_user_id: other.user_id,
    access: "private",
    content: make_page_content("foreign"),
    now: t1,
  });

  const invalid_selection = { ok: false, reason: "invalid_selection" } as const;
  assertEquals(
    await service.bulk_change_managed_access({
      actor: owner,
      access: "invalid" as "public",
      selection: [{ page_id: one.page.page_id, expected_revision: 1 }],
    }),
    { ok: false, reason: "invalid_access" },
  );
  assertEquals(
    await service.bulk_change_managed_access({
      actor: owner,
      access: "public",
      selection: [],
    }),
    invalid_selection,
  );
  assertEquals(
    await service.bulk_change_managed_access({
      actor: owner,
      access: "public",
      selection: [
        { page_id: one.page.page_id, expected_revision: 1 },
        { page_id: "bad id", expected_revision: 1 },
      ],
    }),
    invalid_selection,
  );
  assertEquals(
    await service.bulk_change_managed_access({
      actor: owner,
      access: "public",
      selection: [
        { page_id: one.page.page_id, expected_revision: 1 },
        { page_id: one.page.page_id, expected_revision: 1 },
      ],
    }),
    invalid_selection,
  );
  assertEquals(
    await service.bulk_change_managed_access({
      actor: owner,
      access: "public",
      selection: Array.from(
        { length: max_bulk_managed_pages + 1 },
        (_, index) => ({
          page_id: `oversized-${index}`,
          expected_revision: 1,
        }),
      ),
    }),
    invalid_selection,
  );
  assertEquals((await repository.find_by_id(one.page.page_id))?.revision, 1);

  const changed = await service.bulk_change_managed_access({
    actor: owner,
    access: "public",
    selection: [
      { page_id: one.page.page_id, expected_revision: 1 },
      { page_id: stale.page.page_id, expected_revision: 2 },
      { page_id: two.page.page_id, expected_revision: 1 },
      { page_id: "foreign", expected_revision: 1 },
      { page_id: "absent", expected_revision: 1 },
    ],
  });
  assert(changed.ok);
  assertEquals(
    changed.results.map((item) =>
      item.ok
        ? {
          page_id: item.page_id,
          ok: true,
          access: item.page.access,
          revision: item.page.revision,
        }
        : item
    ),
    [
      { page_id: "change-one", ok: true, access: "public", revision: 2 },
      {
        page_id: "keep-stale",
        ok: false,
        reason: "revision_conflict",
      },
      { page_id: "change-two", ok: true, access: "public", revision: 2 },
      { page_id: "foreign", ok: false, reason: "not_found" },
      { page_id: "absent", ok: false, reason: "not_found" },
    ],
  );
  const changed_one = await repository.find_by_id(one.page.page_id);
  const changed_two = await repository.find_by_id(two.page.page_id);
  assertEquals(changed_one?.tags, ["keep"]);
  assertEquals(changed_one?.updated_at, t2);
  assertEquals(changed_two?.updated_at, t2);
  assertEquals((await repository.find_by_id(stale.page.page_id))?.revision, 1);
});

Deno.test("PageService concurrent bulk access commands have one item winner per revision", async () => {
  const { service } = await make_fixture({ ids: ["bulk-race"] });
  const created = await service.create_managed(managed_request());
  assert(created.ok);
  const results = await Promise.all([
    service.bulk_change_managed_access({
      actor: owner,
      access: "public",
      selection: [{ page_id: created.page.page_id, expected_revision: 1 }],
    }),
    service.bulk_change_managed_access({
      actor: owner,
      access: "public",
      selection: [{ page_id: created.page.page_id, expected_revision: 1 }],
    }),
  ]);
  assert(results.every((result) => result.ok));
  const items = results.flatMap((result) => result.ok ? result.results : []);
  assertEquals(items.filter((item) => item.ok).length, 1);
  assertEquals(
    items.filter((item) => !item.ok).map((item) => item.reason),
    ["revision_conflict"],
  );
});

Deno.test("PageService bulk delete is prevalidated and independently revision-bound", async () => {
  const { service, repository } = await make_fixture({
    ids: ["delete-one", "keep-stale", "delete-two"],
  });
  const one = await service.create_managed(managed_request("one"));
  const stale = await service.create_managed(managed_request("stale"));
  const two = await service.create_managed(managed_request("two"));
  assert(one.ok && stale.ok && two.ok);
  await repository.create_managed({
    page_id: "foreign-delete",
    locator: { namespace: "Theirs", page_name: "foreign" },
    owner_user_id: other.user_id,
    access: "private",
    content: make_page_content("foreign"),
    now: t1,
  });

  assertEquals(
    await service.bulk_delete_managed({
      actor: owner,
      selection: [
        { page_id: one.page.page_id, expected_revision: 1 },
        { page_id: "bad id", expected_revision: 1 },
      ],
    }),
    { ok: false, reason: "invalid_selection" },
  );
  assert((await repository.find_by_id(one.page.page_id)) !== null);

  const deleted = await service.bulk_delete_managed({
    actor: owner,
    selection: [
      { page_id: one.page.page_id, expected_revision: 1 },
      { page_id: stale.page.page_id, expected_revision: 2 },
      { page_id: "foreign-delete", expected_revision: 1 },
      { page_id: "absent-delete", expected_revision: 1 },
      { page_id: two.page.page_id, expected_revision: 1 },
    ],
  });
  assert(deleted.ok);
  assertEquals(deleted.results, [
    { page_id: "delete-one", ok: true },
    { page_id: "keep-stale", ok: false, reason: "revision_conflict" },
    { page_id: "foreign-delete", ok: false, reason: "not_found" },
    { page_id: "absent-delete", ok: false, reason: "not_found" },
    { page_id: "delete-two", ok: true },
  ]);
  assertEquals(await repository.find_by_id(one.page.page_id), null);
  assertEquals(await repository.find_by_id(two.page.page_id), null);
  assertEquals((await repository.find_by_id(stale.page.page_id))?.revision, 1);
  assert((await repository.find_by_id("foreign-delete")) !== null);
});

Deno.test("PageService direct delivery permits public pages and only the private owner", async () => {
  const { service } = await make_fixture({ ids: ["public-1", "private-1"] });
  const public_page = await service.create_managed(
    managed_request("public", "public"),
  );
  const private_page = await service.create_managed(
    managed_request("private", "private"),
  );
  assert(public_page.ok && private_page.ok);
  assert(
    (await service.deliver(
      { namespace: "MINE", page_name: "PUBLIC" },
      guest,
    )).ok,
  );
  for (const actor of [guest, other]) {
    assertEquals(
      await service.deliver(
        { namespace: "Mine", page_name: "private" },
        actor,
      ),
      { ok: false, reason: "not_found" },
    );
  }
  const delivered = await service.deliver(
    { namespace: "Mine", page_name: "private" },
    owner,
  );
  assert(delivered.ok);
  assertEquals(delivered.payload.media_type, "text/html; charset=utf-8");
});

Deno.test("PageService authorizes private delivery before retired-handler disclosure", async () => {
  const { service, repository } = await make_fixture();
  await repository.create_managed({
    page_id: "retired-private",
    locator: { namespace: "Mine", page_name: "retired" },
    owner_user_id: owner.user_id,
    access: "private",
    content: {
      content_type: "retired",
      data: {},
      meta: { media_type: "text/plain", size_bytes: 0 },
    },
    now: t1,
  });
  assertEquals(
    await service.deliver(
      { namespace: "Mine", page_name: "retired" },
      guest,
    ),
    { ok: false, reason: "not_found" },
  );
  assertEquals(
    await service.deliver(
      { namespace: "Mine", page_name: "retired" },
      owner,
    ),
    { ok: false, reason: "unknown_content_type" },
  );
  assertEquals(
    await service.update_managed({
      actor: owner,
      page_id: "retired-private",
      expected_revision: 1,
      patch: { access: "public" },
    }),
    { ok: false, reason: "unknown_content_type" },
  );
  assertEquals((await repository.find_by_id("retired-private"))?.revision, 1);
});

Deno.test("PageService public view resolves eligible pages and hides the rest", async () => {
  const { service } = await make_fixture({
    ids: ["default-1", "public-1", "private-1", "trial-1"],
  });
  const default_page = await service.create_managed({
    ...managed_request("ignored", "public", "# Default"),
    locator: { namespace: "Mine" },
  });
  const named = await service.create_managed(
    managed_request("pub", "public"),
  );
  const hidden = await service.create_managed(
    managed_request("secret", "private"),
  );
  const trial = await service.publish_trial(trial_request("Free"));
  assert(default_page.ok && named.ok && hidden.ok && trial.ok);

  // A locator without a page name resolves the namespace default page.
  const viewed_default = await service.view_public({ namespace: "MINE" });
  assert(viewed_default.ok);
  assertEquals(viewed_default.page.path, "/Mine");
  assertEquals(viewed_default.page.stewardship, "managed");
  assertEquals(viewed_default.page.content_type, "md-page");
  assertEquals(viewed_default.page.media_type, "text/html; charset=utf-8");
  assertEquals("page_id" in viewed_default.page, false);
  assertEquals("revision" in viewed_default.page, false);

  const viewed_named = await service.view_public({
    namespace: "mine",
    page_name: "PUB",
  });
  assert(viewed_named.ok);
  assertEquals(viewed_named.page.path, "/Mine/pub");

  const viewed_trial = await service.view_public({ namespace: "free" });
  assert(viewed_trial.ok);
  assertEquals(viewed_trial.page.stewardship, "trial");

  const not_found = { ok: false, reason: "not_found" } as const;
  assertEquals(
    await service.view_public({ namespace: "Mine", page_name: "secret" }),
    not_found,
  );
  assertEquals(
    await service.view_public({ namespace: "Mine", page_name: "absent" }),
    not_found,
  );
  assertEquals(await service.view_public({ namespace: "site" }), not_found);
  assertEquals(await service.view_public({ namespace: "a/b" }), not_found);
});

Deno.test("PageService public listing validates namespace and maps visitor-safe rows", async () => {
  const { service } = await make_fixture({
    ids: ["default-1", "public-1", "private-1", "trial-1"],
  });
  await service.create_managed({
    ...managed_request("ignored", "public"),
    locator: { namespace: "Mine" },
  });
  await service.create_managed(managed_request("pub", "public"));
  await service.create_managed(managed_request("secret", "private"));
  await service.publish_trial(trial_request("Free"));

  const listed = await service.list_public({ namespace: "MINE", limit: 10 });
  assert(listed.ok);
  assertEquals(
    listed.pages.map((page) => page.path),
    ["/Mine", "/Mine/pub"],
  );
  assert(
    listed.pages.every((page) =>
      page.stewardship === "managed" &&
      !("page_id" in page) && !("revision" in page) && !("access" in page)
    ),
  );
  assertEquals(listed.next_cursor, null);

  const first = await service.list_public({ namespace: "mine", limit: 1 });
  assert(first.ok && first.next_cursor !== null);
  const second = await service.list_public({
    namespace: "Mine",
    limit: 10,
    cursor: first.next_cursor,
  });
  assert(second.ok);
  assertEquals(second.pages.map((page) => page.path), ["/Mine/pub"]);

  const guest_namespace = await service.list_public({
    namespace: "free",
    limit: 10,
  });
  assert(guest_namespace.ok);
  assertEquals(guest_namespace.pages, []);

  assertEquals(
    await service.list_public({ namespace: "a/b", limit: 10 }),
    { ok: false, reason: "invalid_namespace" },
  );
  assertEquals(
    await service.list_public({ namespace: "site", limit: 10 }),
    { ok: false, reason: "forbidden_namespace" },
  );
  assertEquals(
    await service.list_public({ namespace: "Mine", limit: 10, cursor: "!" }),
    { ok: false, reason: "invalid_cursor" },
  );
});

Deno.test("PageService explores normalized name queries with visitor-safe results", async () => {
  const { service, repository } = await make_fixture();
  for (
    const [page_id, namespace, page_name, access, tags] of [
      ["alice-default", "Alice", undefined, "public", ["featured"]],
      ["alice-notes", "Alice", "Notes", "public", ["deno", "featured"]],
      ["alicia-notebook", "Alicia", "Notebook", "public", ["deno"]],
      ["hidden", "Alice", "Secret notes", "private", ["deno"]],
    ] as const
  ) {
    const seeded = await repository.create_managed({
      page_id,
      locator: page_name === undefined
        ? { namespace }
        : { namespace, page_name },
      owner_user_id: "seed-owner",
      access,
      tags,
      content: make_page_content(page_id),
      now: t1,
    });
    assert(seeded.ok);
  }
  await repository.put_trial({
    page_id: "guest-notes",
    locator: { namespace: "Alice", page_name: "Guest notes" },
    content: make_page_content("guest"),
    now: t1,
  });

  const explored = await service.explore_public({
    namespace_query: "  ALI ",
    page_name_query: " NOTE ",
    tag: " DENO ",
    limit: 10,
  });
  assert(explored.ok);
  assertEquals(
    explored.pages.map((page) => page.path),
    ["/Alice/Notes", "/Alicia/Notebook"],
  );
  assert(
    explored.pages.every((page) =>
      page.stewardship === "managed" && page.tags.includes("deno") &&
      !("page_id" in page) && !("revision" in page) && !("access" in page)
    ),
  );

  const browsed = await service.explore_public({
    namespace_query: "   ",
    limit: 1,
  });
  assert(browsed.ok && browsed.next_cursor !== null);
  const continued = await service.explore_public({
    limit: 10,
    cursor: browsed.next_cursor,
  });
  assert(continued.ok);
  assertEquals(continued.pages.length, 2);

  assertEquals(
    await service.explore_public({
      namespace_query: "x".repeat(101),
      limit: 10,
    }),
    { ok: false, reason: "invalid_query" },
  );
  assertEquals(
    await service.explore_public({ tag: "bad tag!", limit: 10 }),
    { ok: false, reason: "invalid_query" },
  );
  assertEquals(
    await service.explore_public({ limit: 10, cursor: "!" }),
    { ok: false, reason: "invalid_cursor" },
  );
});

Deno.test("PageService retries generated id collisions and reports bounded exhaustion", async () => {
  const { service, repository } = await make_fixture({
    ids: ["collision", "fresh-id"],
    max_page_id_attempts: 2,
  });
  await repository.put_trial({
    page_id: "collision",
    locator: { namespace: "existing" },
    content: make_page_content("existing"),
    now: t1,
  });
  const retried = await service.publish_trial(trial_request("new"));
  assert(retried.ok);
  assertEquals(retried.page.page_id, "fresh-id");

  const exhausted_fixture = await make_fixture({
    ids: ["collision", "collision"],
    max_page_id_attempts: 2,
  });
  await exhausted_fixture.repository.put_trial({
    page_id: "collision",
    locator: { namespace: "existing" },
    content: make_page_content("existing"),
    now: t1,
  });
  assertEquals(
    await exhausted_fixture.service.publish_trial(trial_request("new")),
    { ok: false, reason: "page_id_generation_exhausted" },
  );
});

Deno.test("PageService rejects invalid dependencies and generated values", async () => {
  const repository = new MemoryPageRepository();
  const namespaces = new MemoryNamespaceRepository();
  const base = {
    engine: new LocatorEngine({ strategies: [new PathSlugStrategy()] }),
    repository,
    namespace_authority: new RepositoryNamespaceAuthorityResolver(namespaces),
  };
  assertThrows(
    () =>
      new PageService({
        ...base,
        handlers: [new MdPageHandler(), new MdPageHandler()],
      }),
    Error,
    "duplicate content type",
  );
  assertThrows(
    () =>
      new PageService({
        ...base,
        handlers: [new MdPageHandler()],
        max_page_name_attempts: 0,
      }),
    Error,
    "max_page_name_attempts",
  );
  const invalid_id_service = new PageService({
    ...base,
    handlers: [new MdPageHandler()],
    page_id_generator: new SequenceIds(["bad id"]),
  });
  await assertRejects(
    () => invalid_id_service.publish_trial(trial_request()),
    Error,
    "invalid page id",
  );
});
