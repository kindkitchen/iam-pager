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
): Promise<PageRecord> {
  const result = await repository.create_managed({
    page_id,
    locator: page_name === undefined ? { namespace } : { namespace, page_name },
    owner_user_id,
    access,
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
    },
  );
}
