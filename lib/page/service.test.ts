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
import type { PageClock, PageIdGenerator } from "./interfaces.ts";
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
