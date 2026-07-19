import { assert, assertEquals, assertRejects } from "@std/assert";
import type { PageRepository } from "./interfaces.ts";
import type { PageAccess, PageContent, PageRecord } from "./model.ts";

export interface PageRepositoryConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  name: string;
  /** Must return a fresh, empty repository for every test. */
  make_repository: () => PageRepository | Promise<PageRepository>;
  /** Optional per-test cleanup (close connections, drop state). */
  teardown?: (repository: PageRepository) => void | Promise<void>;
}

/** Deterministic md-page content whose data pairs md with derived html. */
export function make_page_content(marker: string): PageContent {
  return {
    content_type: "md-page",
    data: { md: marker, html: `<p>${marker}</p>` },
    meta: {
      media_type: "text/html; charset=utf-8",
      size_bytes: marker.length,
    },
  };
}

const t1 = new Date("2026-07-19T01:00:00.000Z");
const t2 = new Date("2026-07-19T02:00:00.000Z");
const t3 = new Date("2026-07-19T03:00:00.000Z");

function only_ok<T extends { ok: boolean }>(
  results: readonly T[],
): Extract<T, { ok: true }>[] {
  return results.filter((result): result is Extract<T, { ok: true }> =>
    result.ok
  );
}

/** Encode ASCII text as an unpadded base64url token (for malformed cursors). */
function base64url(text: string): string {
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function seed_managed(
  repository: PageRepository,
  page_id: string,
  owner_user_id: string,
  namespace: string,
  page_name: string | undefined,
  marker: string,
  access: PageAccess = "public",
  tags: readonly string[] = [],
): Promise<PageRecord> {
  const result = await repository.create_managed({
    page_id,
    locator: page_name === undefined ? { namespace } : { namespace, page_name },
    owner_user_id,
    access,
    tags,
    content: make_page_content(marker),
    now: t1,
  });
  assert(result.ok, `seed create_managed(${page_id}) must succeed`);
  return result.page;
}

/**
 * Implementation-agnostic conformance suite for `PageRepository`
 * (DS-PROTECT): registers the contract's identity, stewardship, atomicity,
 * revision, listing, and isolation rules as Deno tests against any backend.
 */
export function test_page_repository_conformance(
  options: PageRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: PageRepository) => Promise<void>,
  ) => {
    Deno.test(`${options.name}: ${label}`, async () => {
      const repository = await options.make_repository();
      try {
        await run(repository);
      } finally {
        await options.teardown?.(repository);
      }
    });
  };

  conformance_test("find of unknown locator and id returns null", async (
    repository,
  ) => {
    assertEquals(await repository.find_by_locator({ namespace: "ns" }), null);
    assertEquals(
      await repository.find_by_locator({ namespace: "ns", page_name: "p" }),
      null,
    );
    assertEquals(await repository.find_by_id("absent-id"), null);
  });

  conformance_test(
    "put_trial creates a public trial page addressable by id and case-insensitive locator",
    async (repository) => {
      const result = await repository.put_trial({
        page_id: "trial-1",
        locator: { namespace: "Alice", page_name: "Notes/Today" },
        content: make_page_content("v1"),
        now: t1,
      });
      assert(result.ok);
      assertEquals(result.outcome, "created");
      const expected: PageRecord = {
        page_id: "trial-1",
        locator: { namespace: "Alice", page_name: "Notes/Today" },
        stewardship: { kind: "trial" },
        access: "public",
        tags: [],
        revision: 1,
        content: make_page_content("v1"),
        created_at: t1,
        updated_at: t1,
      };
      assertEquals(result.page, expected);
      assertEquals(
        await repository.find_by_locator({
          namespace: "ALICE",
          page_name: "notes/today",
        }),
        expected,
      );
      assertEquals(await repository.find_by_id("trial-1"), expected);
    },
  );

  conformance_test("default and named pages do not collide", async (
    repository,
  ) => {
    const default_put = await repository.put_trial({
      page_id: "default-1",
      locator: { namespace: "ns" },
      content: make_page_content("default"),
      now: t1,
    });
    const named_put = await repository.put_trial({
      page_id: "named-1",
      locator: { namespace: "ns", page_name: "page" },
      content: make_page_content("named"),
      now: t1,
    });
    assert(default_put.ok && named_put.ok);
    assertEquals(default_put.outcome, "created");
    assertEquals(named_put.outcome, "created");
    assertEquals(
      (await repository.find_by_locator({ namespace: "ns" }))?.page_id,
      "default-1",
    );
    assertEquals(
      (await repository.find_by_locator({ namespace: "ns", page_name: "page" }))
        ?.page_id,
      "named-1",
    );
  });

  conformance_test(
    "put_trial replaces trial content preserving id and creation time",
    async (repository) => {
      await repository.put_trial({
        page_id: "trial-1",
        locator: { namespace: "Alice", page_name: "notes" },
        content: make_page_content("v1"),
        now: t1,
      });
      const replaced = await repository.put_trial({
        page_id: "trial-2",
        locator: { namespace: "ALICE", page_name: "NOTES" },
        content: make_page_content("v2"),
        now: t2,
      });
      assert(replaced.ok);
      assertEquals(replaced.outcome, "replaced");
      assertEquals(replaced.page.page_id, "trial-1");
      assertEquals(replaced.page.revision, 2);
      assertEquals(replaced.page.created_at, t1);
      assertEquals(replaced.page.updated_at, t2);
      assertEquals(replaced.page.content, make_page_content("v2"));
      assertEquals(replaced.page.locator, {
        namespace: "ALICE",
        page_name: "NOTES",
      });
      assertEquals(await repository.find_by_id("trial-2"), null);
      assertEquals(
        await repository.find_by_id("trial-1"),
        replaced.page,
      );
    },
  );

  conformance_test("put_trial cannot replace a managed page", async (
    repository,
  ) => {
    const managed = await seed_managed(
      repository,
      "managed-1",
      "owner-1",
      "Alice",
      "notes",
      "managed",
    );
    const attempt = await repository.put_trial({
      page_id: "trial-1",
      locator: { namespace: "alice", page_name: "NOTES" },
      content: make_page_content("intruder"),
      now: t2,
    });
    assertEquals(attempt, { ok: false, reason: "managed_conflict" });
    assertEquals(
      await repository.find_by_locator({
        namespace: "alice",
        page_name: "notes",
      }),
      managed,
    );
  });

  conformance_test(
    "put_trial reports a generated id collision at a new locator",
    async (repository) => {
      await repository.put_trial({
        page_id: "collide",
        locator: { namespace: "one" },
        content: make_page_content("v1"),
        now: t1,
      });
      const attempt = await repository.put_trial({
        page_id: "collide",
        locator: { namespace: "two" },
        content: make_page_content("v2"),
        now: t2,
      });
      assertEquals(attempt, { ok: false, reason: "page_id_conflict" });
      assertEquals(
        await repository.find_by_locator({ namespace: "two" }),
        null,
      );
    },
  );

  conformance_test(
    "create_managed creates a private page at an absent locator",
    async (repository) => {
      const result = await repository.create_managed({
        page_id: "managed-1",
        locator: { namespace: "Alice", page_name: "Secret" },
        owner_user_id: "owner-1",
        access: "private",
        content: make_page_content("v1"),
        now: t1,
      });
      assert(result.ok);
      assertEquals(result.outcome, "created");
      const expected: PageRecord = {
        page_id: "managed-1",
        locator: { namespace: "Alice", page_name: "Secret" },
        stewardship: { kind: "managed", owner_user_id: "owner-1" },
        access: "private",
        tags: [],
        revision: 1,
        content: make_page_content("v1"),
        created_at: t1,
        updated_at: t1,
      };
      assertEquals(result.page, expected);
      assertEquals(
        await repository.find_by_locator({
          namespace: "alice",
          page_name: "secret",
        }),
        expected,
      );
      assertEquals(await repository.find_by_id("managed-1"), expected);
    },
  );

  conformance_test(
    "create_managed replaces a trial and retires its page id",
    async (repository) => {
      await repository.put_trial({
        page_id: "trial-1",
        locator: { namespace: "alice", page_name: "notes" },
        content: make_page_content("trial"),
        now: t1,
      });
      const result = await repository.create_managed({
        page_id: "managed-1",
        locator: { namespace: "Alice", page_name: "Notes" },
        owner_user_id: "owner-1",
        access: "public",
        content: make_page_content("managed"),
        now: t2,
      });
      assert(result.ok);
      assertEquals(result.outcome, "replaced_trial");
      assertEquals(result.page.page_id, "managed-1");
      assertEquals(result.page.revision, 1);
      assertEquals(result.page.created_at, t2);
      assertEquals(result.page.stewardship, {
        kind: "managed",
        owner_user_id: "owner-1",
      });
      assertEquals(await repository.find_by_id("trial-1"), null);
      assertEquals(
        await repository.find_by_locator({
          namespace: "ALICE",
          page_name: "NOTES",
        }),
        result.page,
      );
    },
  );

  conformance_test(
    "create_managed conflicts with an existing managed page without changing the winner",
    async (repository) => {
      const winner = await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "Alice",
        "notes",
        "winner",
      );
      for (
        const [page_id, owner_user_id] of [
          ["challenger-owner-2", "owner-2"],
          ["challenger-owner-1", "owner-1"],
          // Locator conflict takes precedence even when the generated ID also
          // names the winner; callers must not retry a page that already exists.
          ["managed-1", "owner-1"],
        ] as const
      ) {
        const attempt = await repository.create_managed({
          page_id,
          locator: { namespace: "ALICE", page_name: "NOTES" },
          owner_user_id,
          access: "public",
          content: make_page_content("challenger"),
          now: t2,
        });
        assertEquals(attempt, { ok: false, reason: "managed_conflict" });
      }
      assertEquals(
        await repository.find_by_locator({
          namespace: "alice",
          page_name: "notes",
        }),
        winner,
      );
    },
  );

  conformance_test("create_managed reports a generated id collision", async (
    repository,
  ) => {
    await seed_managed(
      repository,
      "collide",
      "owner-1",
      "one",
      undefined,
      "v1",
    );
    const attempt = await repository.create_managed({
      page_id: "collide",
      locator: { namespace: "two" },
      owner_user_id: "owner-1",
      access: "public",
      content: make_page_content("v2"),
      now: t2,
    });
    assertEquals(attempt, { ok: false, reason: "page_id_conflict" });
    assertEquals(await repository.find_by_locator({ namespace: "two" }), null);
  });

  conformance_test(
    "replace_managed updates content and access with one revision increment",
    async (repository) => {
      const created = await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "Alice",
        "notes",
        "v1",
      );
      const replaced = await repository.replace_managed({
        page_id: "managed-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
        access: "private",
        content: make_page_content("v2"),
        now: t2,
      });
      assert(replaced.ok);
      assertEquals(replaced.page, {
        ...created,
        access: "private",
        revision: 2,
        content: make_page_content("v2"),
        updated_at: t2,
      });
      assertEquals(await repository.find_by_id("managed-1"), replaced.page);
      assertEquals(
        await repository.find_by_locator({
          namespace: "alice",
          page_name: "notes",
        }),
        replaced.page,
      );
    },
  );

  conformance_test(
    "replace_managed without content preserves stored content exactly",
    async (repository) => {
      await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "alice",
        undefined,
        "kept",
      );
      const replaced = await repository.replace_managed({
        page_id: "managed-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
        access: "private",
        now: t2,
      });
      assert(replaced.ok);
      assertEquals(replaced.page.access, "private");
      assertEquals(replaced.page.revision, 2);
      assertEquals(replaced.page.content, make_page_content("kept"));
    },
  );

  conformance_test(
    "replace_managed updates and clears canonical tags without replacing content",
    async (repository) => {
      const created = await seed_managed(
        repository,
        "managed-tags",
        "owner-1",
        "alice",
        "notes",
        "kept",
        "public",
        ["deno", "news"],
      );
      const updated = await repository.replace_managed({
        page_id: created.page_id,
        owner_user_id: "owner-1",
        expected_revision: 1,
        access: "public",
        tags: ["archive"],
        now: t2,
      });
      assert(updated.ok);
      assertEquals(updated.page.tags, ["archive"]);
      assertEquals(updated.page.content, created.content);
      const cleared = await repository.replace_managed({
        page_id: created.page_id,
        owner_user_id: "owner-1",
        expected_revision: 2,
        access: "public",
        tags: [],
        now: t3,
      });
      assert(cleared.ok);
      assertEquals(cleared.page.tags, []);
    },
  );

  conformance_test(
    "replace_managed rejects a stale revision without mutating",
    async (repository) => {
      await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "alice",
        undefined,
        "v1",
      );
      const first = await repository.replace_managed({
        page_id: "managed-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
        access: "public",
        content: make_page_content("v2"),
        now: t2,
      });
      assert(first.ok);
      const stale = await repository.replace_managed({
        page_id: "managed-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
        access: "private",
        content: make_page_content("v3"),
        now: t3,
      });
      assertEquals(stale, { ok: false, reason: "revision_conflict" });
      assertEquals(await repository.find_by_id("managed-1"), first.page);
    },
  );

  conformance_test(
    "replace_managed does not disclose missing, trial, or foreign pages",
    async (repository) => {
      await repository.put_trial({
        page_id: "trial-1",
        locator: { namespace: "guest" },
        content: make_page_content("trial"),
        now: t1,
      });
      await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "alice",
        undefined,
        "v1",
      );
      for (
        const [page_id, owner_user_id] of [
          ["absent-1", "owner-1"],
          ["trial-1", "owner-1"],
          ["managed-1", "owner-2"],
        ] as const
      ) {
        const attempt = await repository.replace_managed({
          page_id,
          owner_user_id,
          expected_revision: 1,
          access: "public",
          content: make_page_content("intruder"),
          now: t2,
        });
        assertEquals(attempt, { ok: false, reason: "not_found" });
      }
    },
  );

  conformance_test(
    "rename_managed atomically moves locator and owner ordering",
    async (repository) => {
      const created = await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "Alice",
        "notes",
        "v1",
        "private",
      );
      const renamed = await repository.rename_managed({
        page_id: created.page_id,
        owner_user_id: "owner-1",
        expected_revision: 1,
        locator: { namespace: "Alice", page_name: "Reports" },
        now: t2,
      });
      assert(renamed.ok);
      assertEquals(renamed.outcome, "renamed");
      assertEquals(renamed.page, {
        ...created,
        locator: { namespace: "Alice", page_name: "Reports" },
        revision: 2,
        updated_at: t2,
      });
      assertEquals(
        await repository.find_by_locator({
          namespace: "alice",
          page_name: "notes",
        }),
        null,
      );
      assertEquals(
        await repository.find_by_locator({
          namespace: "ALICE",
          page_name: "reports",
        }),
        renamed.page,
      );
      assertEquals(await repository.find_by_id(created.page_id), renamed.page);
      const listed = await repository.list_managed({
        owner_user_id: "owner-1",
        limit: 10,
      });
      assert(listed.ok);
      assertEquals(listed.pages, [renamed.page]);
    },
  );

  conformance_test(
    "rename_managed replaces a trial but never another managed page",
    async (repository) => {
      await seed_managed(
        repository,
        "source",
        "owner-1",
        "alice",
        "source",
        "source",
      );
      const protected_target = await seed_managed(
        repository,
        "protected",
        "owner-1",
        "alice",
        "protected",
        "protected",
      );
      const conflict = await repository.rename_managed({
        page_id: "source",
        owner_user_id: "owner-1",
        expected_revision: 1,
        locator: { namespace: "alice", page_name: "PROTECTED" },
        now: t2,
      });
      assertEquals(conflict, { ok: false, reason: "locator_conflict" });
      assertEquals(await repository.find_by_id("protected"), protected_target);
      assertEquals((await repository.find_by_id("source"))?.revision, 1);

      await repository.put_trial({
        page_id: "trial-target",
        locator: { namespace: "alice", page_name: "available" },
        content: make_page_content("trial"),
        now: t1,
      });
      const replaced = await repository.rename_managed({
        page_id: "source",
        owner_user_id: "owner-1",
        expected_revision: 1,
        locator: { namespace: "Alice", page_name: "Available" },
        now: t2,
      });
      assert(replaced.ok);
      assertEquals(replaced.outcome, "replaced_trial");
      assertEquals(replaced.page.page_id, "source");
      assertEquals(replaced.page.revision, 2);
      assertEquals(await repository.find_by_id("trial-target"), null);
      assertEquals(
        (await repository.find_by_locator({
          namespace: "alice",
          page_name: "available",
        }))?.page_id,
        "source",
      );
    },
  );

  conformance_test(
    "rename_managed is revision-bound and owner-nondisclosing",
    async (repository) => {
      await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "alice",
        "notes",
        "v1",
      );
      for (
        const request of [
          {
            page_id: "managed-1",
            owner_user_id: "owner-1",
            expected_revision: 2,
          },
          {
            page_id: "managed-1",
            owner_user_id: "owner-2",
            expected_revision: 1,
          },
          {
            page_id: "absent",
            owner_user_id: "owner-1",
            expected_revision: 1,
          },
        ]
      ) {
        const result = await repository.rename_managed({
          ...request,
          locator: { namespace: "alice", page_name: "moved" },
          now: t2,
        });
        assertEquals(
          result,
          request.expected_revision === 2
            ? { ok: false, reason: "revision_conflict" }
            : { ok: false, reason: "not_found" },
        );
      }
      assertEquals(
        (await repository.find_by_id("managed-1"))?.locator.page_name,
        "notes",
      );
    },
  );

  conformance_test(
    "duplicate_managed copies a revision-bound snapshot under fresh identity",
    async (repository) => {
      const source = await seed_managed(
        repository,
        "source",
        "owner-1",
        "Alice",
        "notes",
        "source",
        "private",
        ["draft", "reference"],
      );
      const duplicated = await repository.duplicate_managed({
        source_page_id: "source",
        owner_user_id: "owner-1",
        expected_revision: 1,
        page_id: "duplicate",
        locator: { namespace: "Alice", page_name: "generated-name" },
        now: t2,
      });
      assert(duplicated.ok);
      assertEquals(duplicated.outcome, "created");
      assertEquals(duplicated.page, {
        ...source,
        page_id: "duplicate",
        locator: { namespace: "Alice", page_name: "generated-name" },
        revision: 1,
        created_at: t2,
        updated_at: t2,
      });
      assertEquals(await repository.find_by_id("source"), source);
      assertEquals(await repository.find_by_id("duplicate"), duplicated.page);
      const listed = await repository.list_managed({
        owner_user_id: "owner-1",
        limit: 10,
      });
      assert(listed.ok);
      assertEquals(
        listed.pages.map((page) => page.page_id),
        ["duplicate", "source"],
      );
    },
  );

  conformance_test(
    "duplicate_managed replaces trials and reports protected locator or id conflicts",
    async (repository) => {
      await seed_managed(
        repository,
        "source",
        "owner-1",
        "alice",
        "source",
        "source",
      );
      await seed_managed(
        repository,
        "protected",
        "owner-1",
        "alice",
        "protected",
        "protected",
      );
      assertEquals(
        await repository.duplicate_managed({
          source_page_id: "source",
          owner_user_id: "owner-1",
          expected_revision: 1,
          page_id: "copy-1",
          locator: { namespace: "alice", page_name: "protected" },
          now: t2,
        }),
        { ok: false, reason: "locator_conflict" },
      );
      assertEquals(
        await repository.duplicate_managed({
          source_page_id: "source",
          owner_user_id: "owner-1",
          expected_revision: 1,
          page_id: "protected",
          locator: { namespace: "alice", page_name: "new-name" },
          now: t2,
        }),
        { ok: false, reason: "page_id_conflict" },
      );

      await repository.put_trial({
        page_id: "trial-target",
        locator: { namespace: "alice", page_name: "available" },
        content: make_page_content("trial"),
        now: t1,
      });
      const replaced = await repository.duplicate_managed({
        source_page_id: "source",
        owner_user_id: "owner-1",
        expected_revision: 1,
        page_id: "copy-2",
        locator: { namespace: "Alice", page_name: "Available" },
        now: t2,
      });
      assert(replaced.ok);
      assertEquals(replaced.outcome, "replaced_trial");
      assertEquals(await repository.find_by_id("trial-target"), null);
      assertEquals((await repository.find_by_id("copy-2"))?.revision, 1);
      assertEquals((await repository.find_by_id("source"))?.revision, 1);
    },
  );

  conformance_test(
    "duplicate_managed is revision-bound and owner-nondisclosing",
    async (repository) => {
      await seed_managed(
        repository,
        "source",
        "owner-1",
        "alice",
        "source",
        "source",
      );
      assertEquals(
        await repository.duplicate_managed({
          source_page_id: "source",
          owner_user_id: "owner-1",
          expected_revision: 2,
          page_id: "copy-stale",
          locator: { namespace: "alice", page_name: "stale" },
          now: t2,
        }),
        { ok: false, reason: "revision_conflict" },
      );
      for (
        const [source_page_id, owner_user_id] of [
          ["source", "owner-2"],
          ["absent", "owner-1"],
        ] as const
      ) {
        assertEquals(
          await repository.duplicate_managed({
            source_page_id,
            owner_user_id,
            expected_revision: 1,
            page_id: `copy-${owner_user_id}`,
            locator: { namespace: "alice", page_name: "hidden" },
            now: t2,
          }),
          { ok: false, reason: "not_found" },
        );
      }
      assertEquals(
        await repository.find_by_locator({
          namespace: "alice",
          page_name: "stale",
        }),
        null,
      );
    },
  );

  conformance_test("delete_managed removes id and locator visibility", async (
    repository,
  ) => {
    await seed_managed(
      repository,
      "managed-1",
      "owner-1",
      "Alice",
      "notes",
      "v1",
    );
    const deleted = await repository.delete_managed({
      page_id: "managed-1",
      owner_user_id: "owner-1",
      expected_revision: 1,
    });
    assertEquals(deleted, { ok: true });
    assertEquals(await repository.find_by_id("managed-1"), null);
    assertEquals(
      await repository.find_by_locator({
        namespace: "alice",
        page_name: "notes",
      }),
      null,
    );
    assertEquals(
      await repository.delete_managed({
        page_id: "managed-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
      }),
      { ok: false, reason: "not_found" },
    );
  });

  conformance_test(
    "delete_managed rejects stale revisions and foreign owners",
    async (repository) => {
      await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "alice",
        undefined,
        "v1",
      );
      const bumped = await repository.replace_managed({
        page_id: "managed-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
        access: "public",
        content: make_page_content("v2"),
        now: t2,
      });
      assert(bumped.ok);
      assertEquals(
        await repository.delete_managed({
          page_id: "managed-1",
          owner_user_id: "owner-1",
          expected_revision: 1,
        }),
        { ok: false, reason: "revision_conflict" },
      );
      assertEquals(
        await repository.delete_managed({
          page_id: "managed-1",
          owner_user_id: "owner-2",
          expected_revision: 2,
        }),
        { ok: false, reason: "not_found" },
      );
      assertEquals(await repository.find_by_id("managed-1"), bumped.page);
      assertEquals(
        await repository.delete_managed({
          page_id: "managed-1",
          owner_user_id: "owner-1",
          expected_revision: 2,
        }),
        { ok: true },
      );
    },
  );

  conformance_test(
    "list_managed returns only the owner's pages in deterministic order",
    async (repository) => {
      await seed_managed(repository, "id-bz", "owner-1", "beta", "z", "m1");
      await seed_managed(
        repository,
        "id-bd",
        "owner-1",
        "beta",
        undefined,
        "m2",
      );
      await seed_managed(repository, "id-ab", "owner-1", "Alpha", "b", "m3");
      await seed_managed(repository, "id-aa", "owner-1", "alpha", "A", "m4");
      await seed_managed(
        repository,
        "id-other",
        "owner-2",
        "gamma",
        undefined,
        "m5",
      );
      await repository.put_trial({
        page_id: "id-trial",
        locator: { namespace: "delta" },
        content: make_page_content("trial"),
        now: t1,
      });
      const listed = await repository.list_managed({
        owner_user_id: "owner-1",
        limit: 10,
      });
      assert(listed.ok);
      assertEquals(
        listed.pages.map((page) => page.page_id),
        ["id-aa", "id-ab", "id-bd", "id-bz"],
      );
      assertEquals(listed.next_cursor, null);
      const other = await repository.list_managed({
        owner_user_id: "owner-2",
        limit: 10,
      });
      assert(other.ok);
      assertEquals(other.pages.map((page) => page.page_id), ["id-other"]);
    },
  );

  conformance_test(
    "list_managed filters by namespace case-insensitively",
    async (
      repository,
    ) => {
      await seed_managed(repository, "id-one-a", "owner-1", "One", "a", "m1");
      await seed_managed(
        repository,
        "id-one-d",
        "owner-1",
        "one",
        undefined,
        "m2",
      );
      await seed_managed(repository, "id-two-a", "owner-1", "two", "a", "m3");
      const listed = await repository.list_managed({
        owner_user_id: "owner-1",
        namespace: "ONE",
        limit: 10,
      });
      assert(listed.ok);
      assertEquals(
        listed.pages.map((page) => page.page_id),
        ["id-one-d", "id-one-a"],
      );
      assertEquals(listed.next_cursor, null);
    },
  );

  conformance_test(
    "list_managed AND-filters page name, access, and tag across pagination gaps",
    async (repository) => {
      await seed_managed(
        repository,
        "alpha-default",
        "owner-1",
        "alpha",
        undefined,
        "m1",
        "public",
        ["deno"],
      );
      await seed_managed(
        repository,
        "alpha-notes",
        "owner-1",
        "alpha",
        "Release notes",
        "m2",
        "public",
        ["deno", "news"],
      );
      await seed_managed(
        repository,
        "alpha-private",
        "owner-1",
        "alpha",
        "Release private",
        "m3",
        "private",
        ["deno"],
      );
      await seed_managed(
        repository,
        "beta-release",
        "owner-1",
        "beta",
        "Release plan",
        "m4",
        "public",
        ["deno"],
      );
      await seed_managed(
        repository,
        "beta-other-tag",
        "owner-1",
        "beta",
        "Release report",
        "m5",
        "public",
        ["other"],
      );
      const scope = {
        owner_user_id: "owner-1",
        page_name_query: "release",
        access: "public" as const,
        tag: "deno",
      };
      const first = await repository.list_managed({ ...scope, limit: 1 });
      assert(first.ok && first.next_cursor !== null);
      assertEquals(first.pages.map((page) => page.page_id), ["alpha-notes"]);
      const second = await repository.list_managed({
        ...scope,
        limit: 1,
        cursor: first.next_cursor,
      });
      assert(second.ok);
      assertEquals(second.pages.map((page) => page.page_id), ["beta-release"]);
      assertEquals(second.next_cursor, null);
      assertEquals(
        await repository.list_managed({
          ...scope,
          tag: "news",
          limit: 1,
          cursor: first.next_cursor,
        }),
        { ok: false, reason: "invalid_cursor" },
      );
    },
  );

  conformance_test("list_managed paginates with a continuation cursor", async (
    repository,
  ) => {
    const expected_ids = ["id-1", "id-2", "id-3", "id-4", "id-5"];
    for (const [index, page_id] of expected_ids.entries()) {
      await seed_managed(
        repository,
        page_id,
        "owner-1",
        "alice",
        `page-${index + 1}`,
        `m${index}`,
      );
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let rounds = 0;
    while (true) {
      const listed = await repository.list_managed({
        owner_user_id: "owner-1",
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      assert(listed.ok);
      seen.push(...listed.pages.map((page) => page.page_id));
      rounds += 1;
      if (listed.next_cursor === null) break;
      cursor = listed.next_cursor;
      assert(rounds < 10, "pagination must terminate");
    }
    assertEquals(seen, expected_ids);
    assertEquals(rounds, 3);
  });

  conformance_test(
    "list_managed rejects invalid, oversized, padded, and mismatched cursors",
    async (repository) => {
      for (const page_name of ["a", "b", "c"]) {
        await seed_managed(
          repository,
          `id-${page_name}`,
          "owner-1",
          "alice",
          page_name,
          page_name,
        );
      }
      const first = await repository.list_managed({
        owner_user_id: "owner-1",
        namespace: "alice",
        limit: 1,
      });
      assert(first.ok && first.next_cursor !== null);
      const bad_cursors: { cursor: string; namespace?: string }[] = [
        { cursor: "not base64url!" },
        { cursor: "A".repeat(3000) },
        { cursor: `${first.next_cursor}=`, namespace: "alice" },
        // issued with a filter, replayed without one (and vice versa)
        { cursor: first.next_cursor },
        { cursor: base64url("[1,2]") },
        { cursor: base64url(JSON.stringify({ namespace_key: "alice" })) },
        {
          cursor: base64url(JSON.stringify({
            namespace_key: "ALICE",
            default_rank: 1,
            page_name_key: "a",
            page_id: "id-a",
            filter: null,
          })),
        },
        {
          cursor: base64url(JSON.stringify({
            namespace_key: "alice",
            default_rank: 0,
            page_name_key: "a",
            page_id: "id-a",
            filter: null,
          })),
        },
      ];
      for (const { cursor, namespace } of bad_cursors) {
        const listed = await repository.list_managed({
          owner_user_id: "owner-1",
          limit: 2,
          cursor,
          ...(namespace === undefined ? {} : { namespace }),
        });
        assertEquals(
          listed,
          { ok: false, reason: "invalid_cursor" },
          `cursor must be rejected: ${cursor.slice(0, 40)}`,
        );
      }
    },
  );

  conformance_test(
    "list_public returns only the namespace's public managed pages in order",
    async (repository) => {
      await seed_managed(repository, "pub-z", "owner-1", "Alice", "z", "m1");
      await seed_managed(
        repository,
        "pub-d",
        "owner-1",
        "alice",
        undefined,
        "m2",
      );
      await seed_managed(repository, "pub-a", "owner-1", "ALICE", "A", "m3");
      await seed_managed(
        repository,
        "hidden-private",
        "owner-1",
        "alice",
        "secret",
        "m4",
        "private",
      );
      await seed_managed(repository, "other-ns", "owner-1", "beta", "b", "m5");
      await repository.put_trial({
        page_id: "trial-in-ns",
        locator: { namespace: "alice", page_name: "guest" },
        content: make_page_content("trial"),
        now: t1,
      });
      const listed = await repository.list_public({
        namespace: "Alice",
        limit: 10,
      });
      assert(listed.ok);
      assertEquals(
        listed.pages.map((page) => page.page_id),
        ["pub-d", "pub-a", "pub-z"],
      );
      assert(
        listed.pages.every((page) =>
          page.access === "public" && page.stewardship.kind === "managed"
        ),
      );
      assertEquals(listed.next_cursor, null);
      const unreserved = await repository.list_public({
        namespace: "delta",
        limit: 10,
      });
      assert(unreserved.ok);
      assertEquals(unreserved.pages, []);
      assertEquals(unreserved.next_cursor, null);
    },
  );

  conformance_test(
    "list_public paginates across ineligible pages with a continuation cursor",
    async (repository) => {
      const expected_ids = ["pub-1", "pub-2", "pub-3", "pub-4", "pub-5"];
      for (const [index, page_id] of expected_ids.entries()) {
        await seed_managed(
          repository,
          page_id,
          "owner-1",
          "alice",
          `page-${index + 1}`,
          `m${index}`,
        );
        await seed_managed(
          repository,
          `priv-${index}`,
          "owner-1",
          "alice",
          `page-${index + 1}-private`,
          `p${index}`,
          "private",
        );
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      let rounds = 0;
      while (true) {
        const listed = await repository.list_public({
          namespace: "alice",
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
        assert(listed.ok);
        assert(listed.pages.length <= 2);
        seen.push(...listed.pages.map((page) => page.page_id));
        rounds += 1;
        if (listed.next_cursor === null) break;
        cursor = listed.next_cursor;
        assert(rounds < 10, "pagination must terminate");
      }
      assertEquals(seen, expected_ids);
      assertEquals(rounds, 3);
    },
  );

  conformance_test(
    "list_public rejects malformed and cross-namespace cursors",
    async (repository) => {
      for (const page_name of ["a", "b", "c"]) {
        await seed_managed(
          repository,
          `id-${page_name}`,
          "owner-1",
          "alice",
          page_name,
          page_name,
        );
        await seed_managed(
          repository,
          `beta-${page_name}`,
          "owner-1",
          "beta",
          page_name,
          page_name,
        );
      }
      const first = await repository.list_public({
        namespace: "alice",
        limit: 1,
      });
      assert(first.ok && first.next_cursor !== null);
      const continued = await repository.list_public({
        namespace: "ALICE",
        limit: 10,
        cursor: first.next_cursor,
      });
      assert(continued.ok, "cursor must survive namespace case changes");
      assertEquals(
        continued.pages.map((page) => page.page_id),
        ["id-b", "id-c"],
      );
      const bad_cursors = [
        "not base64url!",
        "A".repeat(3000),
        `${first.next_cursor}=`,
        base64url("[1,2]"),
      ];
      for (const cursor of bad_cursors) {
        const listed = await repository.list_public({
          namespace: "alice",
          limit: 2,
          cursor,
        });
        assertEquals(
          listed,
          { ok: false, reason: "invalid_cursor" },
          `cursor must be rejected: ${cursor.slice(0, 40)}`,
        );
      }
      const mismatched = await repository.list_public({
        namespace: "beta",
        limit: 2,
        cursor: first.next_cursor,
      });
      assertEquals(mismatched, { ok: false, reason: "invalid_cursor" });
    },
  );

  conformance_test(
    "explore_public browses and searches only public managed pages",
    async (repository) => {
      await seed_managed(
        repository,
        "alice-default",
        "owner-1",
        "Alice",
        undefined,
        "m1",
        "public",
        ["featured"],
      );
      await seed_managed(
        repository,
        "alice-notes",
        "owner-1",
        "alice",
        "Notes",
        "m2",
        "public",
        ["deno", "featured"],
      );
      await seed_managed(
        repository,
        "alicia-notebook",
        "owner-2",
        "Alicia",
        "Notebook",
        "m3",
        "public",
        ["deno"],
      );
      await seed_managed(
        repository,
        "beta-release",
        "owner-2",
        "Beta",
        "Release",
        "m4",
        "public",
        ["release"],
      );
      await seed_managed(
        repository,
        "hidden-private",
        "owner-1",
        "Alice",
        "Private notes",
        "m5",
        "private",
        ["deno"],
      );
      await repository.put_trial({
        page_id: "hidden-trial",
        locator: { namespace: "Alice", page_name: "Guest notes" },
        content: make_page_content("trial"),
        now: t1,
      });

      const browsed = await repository.explore_public({ limit: 20 });
      assert(browsed.ok);
      assertEquals(
        browsed.pages.map((page) => page.page_id),
        ["alice-default", "alice-notes", "alicia-notebook", "beta-release"],
      );
      assert(
        browsed.pages.every((page) =>
          page.access === "public" && page.stewardship.kind === "managed"
        ),
      );

      const by_namespace = await repository.explore_public({
        namespace_query: "ali",
        limit: 20,
      });
      assert(by_namespace.ok);
      assertEquals(
        by_namespace.pages.map((page) => page.page_id),
        ["alice-default", "alice-notes", "alicia-notebook"],
      );

      const by_page_name = await repository.explore_public({
        page_name_query: "note",
        limit: 20,
      });
      assert(by_page_name.ok);
      assertEquals(
        by_page_name.pages.map((page) => page.page_id),
        ["alice-notes", "alicia-notebook"],
      );

      const by_both = await repository.explore_public({
        namespace_query: "alice",
        page_name_query: "note",
        limit: 20,
      });
      assert(by_both.ok);
      assertEquals(
        by_both.pages.map((page) => page.page_id),
        ["alice-notes"],
      );

      const by_tag = await repository.explore_public({
        tag: "deno",
        limit: 20,
      });
      assert(by_tag.ok);
      assertEquals(
        by_tag.pages.map((page) => page.page_id),
        ["alice-notes", "alicia-notebook"],
      );
      const by_names_and_tag = await repository.explore_public({
        namespace_query: "alice",
        page_name_query: "note",
        tag: "featured",
        limit: 20,
      });
      assert(by_names_and_tag.ok);
      assertEquals(
        by_names_and_tag.pages.map((page) => page.page_id),
        ["alice-notes"],
      );

      const made_private = await repository.replace_managed({
        page_id: "alice-notes",
        owner_user_id: "owner-1",
        expected_revision: 1,
        access: "private",
        now: t2,
      });
      assert(made_private.ok);
      const after_access_change = await repository.explore_public({
        namespace_query: "alice",
        page_name_query: "note",
        limit: 20,
      });
      assert(after_access_change.ok);
      assertEquals(after_access_change.pages, []);
    },
  );

  conformance_test(
    "explore_public paginates across query and visibility gaps",
    async (repository) => {
      const expected_ids: string[] = [];
      for (let index = 1; index <= 5; index += 1) {
        const page_id = `public-${index}`;
        expected_ids.push(page_id);
        await seed_managed(
          repository,
          page_id,
          "owner-1",
          `Team-${index}`,
          `Release-${index}`,
          `m${index}`,
          "public",
          ["release"],
        );
        await seed_managed(
          repository,
          `private-${index}`,
          "owner-1",
          `Team-${index}`,
          `Release-${index}-private`,
          `p${index}`,
          "private",
        );
        await repository.put_trial({
          page_id: `trial-${index}`,
          locator: {
            namespace: `Team-${index}`,
            page_name: `Release-${index}-trial`,
          },
          content: make_page_content(`t${index}`),
          now: t1,
        });
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      let rounds = 0;
      while (true) {
        const explored = await repository.explore_public({
          namespace_query: "team-",
          page_name_query: "release-",
          tag: "release",
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
        assert(explored.ok);
        seen.push(...explored.pages.map((page) => page.page_id));
        rounds += 1;
        if (explored.next_cursor === null) break;
        cursor = explored.next_cursor;
        assert(rounds < 10, "pagination must terminate");
      }
      assertEquals(seen, expected_ids);
      assertEquals(rounds, 3);
    },
  );

  conformance_test(
    "explore_public rejects malformed and query-mismatched cursors",
    async (repository) => {
      for (const page_name of ["a", "b", "c"]) {
        await seed_managed(
          repository,
          `id-${page_name}`,
          "owner-1",
          "alice",
          page_name,
          page_name,
        );
      }
      const first = await repository.explore_public({
        namespace_query: "ali",
        limit: 1,
      });
      assert(first.ok && first.next_cursor !== null);
      const continued = await repository.explore_public({
        namespace_query: "ali",
        limit: 10,
        cursor: first.next_cursor,
      });
      assert(continued.ok);
      assertEquals(
        continued.pages.map((page) => page.page_id),
        ["id-b", "id-c"],
      );

      for (
        const request of [
          { namespace_query: "alice" },
          { namespace_query: "ali", page_name_query: "a" },
          {},
        ]
      ) {
        assertEquals(
          await repository.explore_public({
            ...request,
            limit: 2,
            cursor: first.next_cursor,
          }),
          { ok: false, reason: "invalid_cursor" },
        );
      }
      const namespace_cursor = await repository.list_public({
        namespace: "alice",
        limit: 1,
      });
      assert(namespace_cursor.ok && namespace_cursor.next_cursor !== null);
      for (
        const cursor of [
          "not base64url!",
          "A".repeat(3000),
          `${first.next_cursor}=`,
          namespace_cursor.next_cursor,
        ]
      ) {
        assertEquals(
          await repository.explore_public({
            namespace_query: "ali",
            limit: 2,
            cursor,
          }),
          { ok: false, reason: "invalid_cursor" },
        );
      }
    },
  );

  conformance_test(
    "concurrent renames cannot claim one locator twice",
    async (repository) => {
      await seed_managed(
        repository,
        "source-1",
        "owner-1",
        "race",
        "one",
        "one",
      );
      await seed_managed(
        repository,
        "source-2",
        "owner-1",
        "race",
        "two",
        "two",
      );
      const results = await Promise.all(
        ["source-1", "source-2"].map((page_id) =>
          repository.rename_managed({
            page_id,
            owner_user_id: "owner-1",
            expected_revision: 1,
            locator: { namespace: "race", page_name: "winner" },
            now: t2,
          })
        ),
      );
      assertEquals(only_ok(results).length, 1);
      assertEquals(
        results.filter((result) => !result.ok).map((result) => result.reason),
        ["locator_conflict"],
      );
      const winner = await repository.find_by_locator({
        namespace: "race",
        page_name: "winner",
      });
      assert(winner !== null);
      assertEquals(winner.revision, 2);
      const losing_id = winner.page_id === "source-1" ? "source-2" : "source-1";
      assertEquals((await repository.find_by_id(losing_id))?.revision, 1);
    },
  );

  conformance_test(
    "concurrent duplicates cannot claim one generated locator twice",
    async (repository) => {
      const source = await seed_managed(
        repository,
        "source",
        "owner-1",
        "race",
        "source",
        "source",
      );
      const results = await Promise.all(
        ["copy-1", "copy-2"].map((page_id) =>
          repository.duplicate_managed({
            source_page_id: "source",
            owner_user_id: "owner-1",
            expected_revision: 1,
            page_id,
            locator: { namespace: "race", page_name: "generated" },
            now: t2,
          })
        ),
      );
      assertEquals(only_ok(results).length, 1);
      assertEquals(
        results.filter((result) => !result.ok).map((result) => result.reason),
        ["locator_conflict"],
      );
      assertEquals(await repository.find_by_id("source"), source);
      const winner = await repository.find_by_locator({
        namespace: "race",
        page_name: "generated",
      });
      assert(winner !== null);
      assertEquals(winner.revision, 1);
      assertEquals(winner.content, source.content);
    },
  );

  conformance_test(
    "concurrent managed creates settle on exactly one winner",
    async (repository) => {
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map((index) =>
          repository.create_managed({
            page_id: `racer-${index}`,
            locator: { namespace: "Race", page_name: "page" },
            owner_user_id: `owner-${index}`,
            access: "public",
            content: make_page_content(`v${index}`),
            now: t1,
          })
        ),
      );
      const winners = only_ok(results);
      assertEquals(winners.length, 1);
      for (const result of results) {
        if (!result.ok) assertEquals(result.reason, "managed_conflict");
      }
      assertEquals(
        await repository.find_by_locator({
          namespace: "race",
          page_name: "page",
        }),
        winners[0].page,
      );
    },
  );

  conformance_test(
    "concurrent trial puts settle on one complete record",
    async (repository) => {
      const markers = ["a", "b", "c", "d", "e"];
      const results = await Promise.all(
        markers.map((marker, index) =>
          repository.put_trial({
            page_id: `racer-${index}`,
            locator: { namespace: "Race", page_name: "page" },
            content: make_page_content(marker.repeat(2048)),
            now: t1,
          })
        ),
      );
      for (const result of results) assert(result.ok);
      const stored = await repository.find_by_locator({
        namespace: "race",
        page_name: "page",
      });
      assert(stored !== null);
      assertEquals(stored.stewardship, { kind: "trial" });
      assertEquals(stored.access, "public");
      const winner = markers.find((marker) =>
        (stored.content.data as { md: string }).md === marker.repeat(2048)
      );
      assert(winner !== undefined, "stored md must equal one racer's md");
      assertEquals(stored.content, make_page_content(winner.repeat(2048)));
    },
  );

  conformance_test(
    "a trial put racing managed creation cannot overwrite the managed page",
    async (repository) => {
      const managed_content = make_page_content("managed");
      const [managed_result, trial_result] = await Promise.all([
        repository.create_managed({
          page_id: "managed-1",
          locator: { namespace: "race" },
          owner_user_id: "owner-1",
          access: "public",
          content: managed_content,
          now: t1,
        }),
        repository.put_trial({
          page_id: "trial-1",
          locator: { namespace: "Race" },
          content: make_page_content("trial"),
          now: t1,
        }),
      ]);
      assert(managed_result.ok);
      if (!trial_result.ok) {
        assertEquals(trial_result.reason, "managed_conflict");
      }
      const stored = await repository.find_by_locator({ namespace: "race" });
      assertEquals(stored?.stewardship, {
        kind: "managed",
        owner_user_id: "owner-1",
      });
      assertEquals(stored?.content, managed_content);
    },
  );

  conformance_test(
    "concurrent replaces with one expected revision have exactly one winner",
    async (repository) => {
      await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "alice",
        undefined,
        "v1",
      );
      const results = await Promise.all(
        ["v2", "v3"].map((marker) =>
          repository.replace_managed({
            page_id: "managed-1",
            owner_user_id: "owner-1",
            expected_revision: 1,
            access: "public",
            content: make_page_content(marker),
            now: t2,
          })
        ),
      );
      const winners = only_ok(results);
      assertEquals(winners.length, 1);
      for (const result of results) {
        if (!result.ok) assertEquals(result.reason, "revision_conflict");
      }
      const stored = await repository.find_by_id("managed-1");
      assertEquals(stored, winners[0].page);
      assertEquals(stored?.revision, 2);
    },
  );

  conformance_test(
    "a replace and a delete with one expected revision cannot both win",
    async (repository) => {
      await seed_managed(
        repository,
        "managed-1",
        "owner-1",
        "alice",
        undefined,
        "v1",
      );
      const [replaced, deleted] = await Promise.all([
        repository.replace_managed({
          page_id: "managed-1",
          owner_user_id: "owner-1",
          expected_revision: 1,
          access: "private",
          content: make_page_content("v2"),
          now: t2,
        }),
        repository.delete_managed({
          page_id: "managed-1",
          owner_user_id: "owner-1",
          expected_revision: 1,
        }),
      ]);
      assertEquals([replaced.ok, deleted.ok].filter(Boolean).length, 1);
      const stored = await repository.find_by_id("managed-1");
      if (replaced.ok) {
        assertEquals(stored, replaced.page);
      } else {
        assertEquals(stored, null);
      }
    },
  );

  conformance_test(
    "large content and binary data round-trip exactly",
    async (repository) => {
      const md = "M".repeat(200 * 1024) + "-end";
      const large = await repository.put_trial({
        page_id: "large-1",
        locator: { namespace: "big" },
        content: {
          content_type: "md-page",
          data: { md, html: `<p>${"H".repeat(150 * 1024)}</p>` },
          meta: { media_type: "text/html; charset=utf-8", size_bytes: 0 },
        },
        now: t1,
      });
      assert(large.ok);
      assertEquals(await repository.find_by_id("large-1"), large.page);
      const bytes = Uint8Array.from(
        { length: 100 * 1024 },
        (_, index) => index % 251,
      );
      const binary = await repository.create_managed({
        page_id: "binary-1",
        locator: { namespace: "big", page_name: "blob" },
        owner_user_id: "owner-1",
        access: "public",
        content: {
          content_type: "test-binary",
          data: { bytes },
          meta: {
            media_type: "application/octet-stream",
            size_bytes: bytes.byteLength,
            download_filename: "blob.bin",
          },
        },
        now: t1,
      });
      assert(binary.ok);
      const stored = await repository.find_by_id("binary-1");
      assertEquals(stored, binary.page);
      assertEquals(
        (stored?.content.data as { bytes: Uint8Array }).bytes,
        bytes,
      );
    },
  );

  conformance_test(
    "structurally invalid requests are rejected as programming errors",
    async (repository) => {
      const content = make_page_content("v1");
      await assertRejects(() => repository.find_by_id(""));
      await assertRejects(() =>
        repository.put_trial({
          page_id: "bad id!",
          locator: { namespace: "ns" },
          content,
          now: t1,
        })
      );
      await assertRejects(() =>
        repository.put_trial({
          page_id: "ok-id",
          locator: { namespace: "ns" },
          content,
          now: new Date("nope"),
        })
      );
      await assertRejects(() =>
        repository.create_managed({
          page_id: "ok-id",
          locator: { namespace: "ns" },
          owner_user_id: "",
          access: "public",
          content,
          now: t1,
        })
      );
      await assertRejects(() =>
        repository.create_managed({
          page_id: "ok-id",
          locator: { namespace: "ns" },
          owner_user_id: "owner-1",
          access: "secret" as "public",
          content,
          now: t1,
        })
      );
      await assertRejects(() =>
        repository.create_managed({
          page_id: "ok-id",
          locator: { namespace: "ns" },
          owner_user_id: "owner-1",
          access: "public",
          tags: ["news", "deno"],
          content,
          now: t1,
        })
      );
      await assertRejects(() =>
        repository.replace_managed({
          page_id: "ok-id",
          owner_user_id: "owner-1",
          expected_revision: 0,
          access: "public",
          content,
          now: t1,
        })
      );
      await assertRejects(() =>
        repository.delete_managed({
          page_id: "ok-id",
          owner_user_id: "owner-1",
          expected_revision: 1.5,
        })
      );
      await assertRejects(() =>
        repository.rename_managed({
          page_id: "ok-id",
          owner_user_id: "owner-1",
          expected_revision: 0,
          locator: { namespace: "ns", page_name: "moved" },
          now: t1,
        })
      );
      await assertRejects(() =>
        repository.duplicate_managed({
          source_page_id: "bad id!",
          owner_user_id: "owner-1",
          expected_revision: 1,
          page_id: "copy",
          locator: { namespace: "ns", page_name: "copy" },
          now: t1,
        })
      );
      await assertRejects(() =>
        repository.list_managed({ owner_user_id: "owner-1", limit: 0 })
      );
      await assertRejects(() =>
        repository.list_managed({ owner_user_id: "", limit: 10 })
      );
      await assertRejects(() =>
        repository.list_managed({
          owner_user_id: "owner-1",
          namespace: "",
          limit: 10,
        })
      );
      await assertRejects(() =>
        repository.list_managed({
          owner_user_id: "owner-1",
          page_name_query: "Notes",
          limit: 10,
        })
      );
      await assertRejects(() =>
        repository.list_managed({
          owner_user_id: "owner-1",
          tag: "News",
          limit: 10,
        })
      );
      await assertRejects(() =>
        repository.list_public({ namespace: "", limit: 10 })
      );
      await assertRejects(() =>
        repository.list_public({ namespace: "alice", limit: 0 })
      );
      await assertRejects(() => repository.explore_public({ limit: 0 }));
      await assertRejects(() =>
        repository.explore_public({ namespace_query: "Alice", limit: 10 })
      );
      await assertRejects(() =>
        repository.explore_public({ page_name_query: "", limit: 10 })
      );
      await assertRejects(() =>
        repository.explore_public({ tag: "News", limit: 10 })
      );
    },
  );
}
