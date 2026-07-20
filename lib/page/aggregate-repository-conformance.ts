import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ContentAsset } from "../content/asset.ts";
import type {
  ContentAssetCreator,
  ContentAssetReader,
} from "../content/interfaces.ts";
import type { PageAggregate } from "./aggregate.ts";
import type {
  ManagedPageAggregateCreator,
  ManagedPageAggregateDeleter,
  ManagedPageAggregateDuplicator,
  ManagedPageAggregateLister,
  ManagedPageAggregateUpdater,
  PageAggregateReader,
  PageEndpointResolver,
  PublicPageAggregateExplorer,
  PublicPageAggregateLister,
  TrialPageAggregatePublisher,
} from "./aggregate-interfaces.ts";
import type { PageEndpointBinding, PageEndpointSet } from "./endpoint.ts";

export type PageAggregateConformanceSubject =
  & ContentAssetCreator
  & ContentAssetReader
  & PageAggregateReader
  & PageEndpointResolver
  & ManagedPageAggregateLister
  & PublicPageAggregateLister
  & PublicPageAggregateExplorer
  & TrialPageAggregatePublisher
  & ManagedPageAggregateCreator
  & ManagedPageAggregateUpdater
  & ManagedPageAggregateDuplicator
  & ManagedPageAggregateDeleter;

export interface PageAggregateRepositoryConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  readonly name: string;
  /** Must return fresh, empty persistence for every test. */
  readonly make_subject: () =>
    | PageAggregateConformanceSubject
    | Promise<PageAggregateConformanceSubject>;
  readonly teardown?: (
    subject: PageAggregateConformanceSubject,
  ) => void | Promise<void>;
}

const t1 = new Date("2026-07-20T01:00:00.000Z");
const t2 = new Date("2026-07-20T02:00:00.000Z");

export function make_content_asset(
  content_asset_id: string,
  marker: string,
  created_at = t1,
): ContentAsset {
  return {
    content_asset_id,
    content_type: "test-content",
    data: { marker },
    meta: {
      media_type: "application/octet-stream",
      size_bytes: marker.length,
      download_filename: `${marker}.bin`,
    },
    created_at,
  };
}

function binding(
  page_name: string,
  delivery_profile: "inline" | "attachment" = "inline",
  namespace = "Alice",
): PageEndpointBinding {
  return {
    locator: { namespace, page_name },
    delivery_profile,
  };
}

function endpoint_set(
  canonical_name: string,
  alternates: readonly PageEndpointBinding[] = [],
  namespace = "Alice",
): PageEndpointSet {
  return {
    canonical: binding(canonical_name, "inline", namespace),
    alternates,
  };
}

async function create_asset(
  subject: PageAggregateConformanceSubject,
  content_asset_id: string,
  marker = content_asset_id,
): Promise<ContentAsset> {
  const asset = make_content_asset(content_asset_id, marker);
  const created = await subject.create_content_asset(asset);
  assert(created.ok, `asset ${content_asset_id} must be created`);
  return created.asset;
}

async function create_managed(
  subject: PageAggregateConformanceSubject,
  page_id: string,
  content_asset_id: string,
  endpoints: PageEndpointSet,
  access: "public" | "private" = "public",
): Promise<PageAggregate> {
  const created = await subject.create_managed_page_aggregate({
    page_id,
    endpoint_set: endpoints,
    owner_user_id: "owner-1",
    access,
    tags: ["reference"],
    content_asset_id,
    now: t1,
  });
  assert(created.ok, `managed page ${page_id} must be created`);
  return created.page;
}

function only_ok<T extends { ok: boolean }>(
  values: readonly T[],
): Extract<T, { ok: true }>[] {
  return values.filter((value): value is Extract<T, { ok: true }> => value.ok);
}

/**
 * Backend-neutral contract for immutable assets and all-or-none page endpoint
 * persistence. Durable adapters must run this unchanged before selection.
 */
export function test_page_aggregate_repository_conformance(
  options: PageAggregateRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (subject: PageAggregateConformanceSubject) => Promise<void>,
  ) => {
    Deno.test(`${options.name}: ${label}`, async () => {
      const subject = await options.make_subject();
      try {
        await run(subject);
      } finally {
        await options.teardown?.(subject);
      }
    });
  };

  conformance_test(
    "content assets are immutable identities with isolated reads",
    async (subject) => {
      const input = make_content_asset("asset-1", "original");
      const created = await subject.create_content_asset(input);
      assert(created.ok);
      (input.data as { marker: string }).marker = "mutated-input";
      (created.asset.data as { marker: string }).marker = "mutated-result";
      assertEquals(
        await subject.create_content_asset(
          make_content_asset("asset-1", "new"),
        ),
        { ok: false, reason: "content_asset_id_conflict" },
      );
      const found = await subject.find_content_asset_by_id("asset-1");
      assert(found !== null);
      assertEquals((found.data as { marker: string }).marker, "original");
      (found.data as { marker: string }).marker = "mutated-read";
      const reread = await subject.find_content_asset_by_id("asset-1");
      assert(reread !== null);
      assertEquals((reread.data as { marker: string }).marker, "original");
      assertEquals(await subject.find_content_asset_by_id("missing"), null);
    },
  );

  conformance_test(
    "structurally invalid asset and endpoint records are programming errors",
    async (subject) => {
      await assertRejects(
        () =>
          subject.create_content_asset({
            ...make_content_asset("valid-id", "bad"),
            content_asset_id: "invalid id",
          }),
        Error,
        "route-safe opaque id",
      );
      await assertRejects(
        () =>
          subject.create_content_asset({
            ...make_content_asset("valid-id", "bad"),
            content_asset_id: undefined as unknown as string,
          }),
        Error,
        "route-safe opaque id",
      );
      await create_asset(subject, "asset-1");
      await assertRejects(
        () =>
          subject.create_managed_page_aggregate({
            page_id: undefined as unknown as string,
            endpoint_set: endpoint_set("canonical"),
            owner_user_id: "owner-1",
            access: "public",
            content_asset_id: "asset-1",
            now: t1,
          }),
        Error,
        "route-safe opaque id",
      );
      await assertRejects(
        () =>
          subject.create_managed_page_aggregate({
            page_id: "page-1",
            endpoint_set: endpoint_set("canonical", [
              binding("z-last"),
              binding("a-first"),
            ]),
            owner_user_id: "owner-1",
            access: "public",
            content_asset_id: "asset-1",
            now: t1,
          }),
        Error,
        "ordered by locator identity",
      );
      assertEquals(await subject.find_page_aggregate_by_id("page-1"), null);
    },
  );

  conformance_test(
    "page publication requires a fully created asset and leaves no endpoints on failure",
    async (subject) => {
      const endpoints = endpoint_set("preview", [
        binding("download", "attachment"),
      ]);
      assertEquals(
        await subject.create_managed_page_aggregate({
          page_id: "page-1",
          endpoint_set: endpoints,
          owner_user_id: "owner-1",
          access: "public",
          content_asset_id: "missing-asset",
          now: t1,
        }),
        { ok: false, reason: "content_asset_not_found" },
      );
      assertEquals(await subject.find_page_aggregate_by_id("page-1"), null);
      assertEquals(
        await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "preview",
        }),
        null,
      );
      assertEquals(
        await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "download",
        }),
        null,
      );
    },
  );

  conformance_test(
    "canonical and alternate endpoints resolve one page and immutable asset",
    async (subject) => {
      await create_asset(subject, "asset-1", "same-bytes");
      const endpoints = endpoint_set("Preview", [
        binding("Download", "attachment", "ALICE"),
      ]);
      const page = await create_managed(
        subject,
        "page-1",
        "asset-1",
        endpoints,
        "private",
      );
      for (
        const [page_name, profile] of [
          ["PREVIEW", "inline"],
          ["download", "attachment"],
        ] as const
      ) {
        const resolved = await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name,
        });
        assert(resolved !== null);
        assertEquals(resolved.page, page);
        assertEquals(resolved.page.page_id, "page-1");
        assertEquals(resolved.page.content_asset_id, "asset-1");
        assertEquals(resolved.endpoint.delivery_profile, profile);
      }
      assertEquals(await subject.find_page_aggregate_by_id("page-1"), page);
      assertEquals(
        (await subject.find_content_asset_by_id("asset-1"))?.data,
        { marker: "same-bytes" },
      );
    },
  );

  conformance_test(
    "page publication isolates endpoint, timestamp, and returned state",
    async (subject) => {
      await create_asset(subject, "asset-1");
      const endpoints = endpoint_set("Preview", [
        binding("Download", "attachment"),
      ]);
      const now = new Date(t1);
      const created = await subject.create_managed_page_aggregate({
        page_id: "page-1",
        endpoint_set: endpoints,
        owner_user_id: "owner-1",
        access: "public",
        content_asset_id: "asset-1",
        now,
      });
      assert(created.ok);
      endpoints.canonical.locator.page_name = "mutated-input";
      now.setUTCFullYear(2030);
      created.page.endpoint_set.canonical.locator.page_name = "mutated-result";
      created.page.created_at.setUTCFullYear(2031);

      const stored = await subject.find_page_aggregate_by_id("page-1");
      assert(stored !== null);
      assertEquals(stored.endpoint_set.canonical.locator.page_name, "Preview");
      assertEquals(stored.created_at, t1);
      assertEquals(
        (await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "preview",
        }))?.page,
        stored,
      );
    },
  );

  conformance_test(
    "one managed endpoint conflict rejects the complete create",
    async (subject) => {
      await create_asset(subject, "asset-winner");
      await create_asset(subject, "asset-loser");
      const winner = await create_managed(
        subject,
        "winner",
        "asset-winner",
        endpoint_set("taken"),
      );
      const attempt = await subject.create_managed_page_aggregate({
        page_id: "loser",
        endpoint_set: endpoint_set("free", [binding("TAKEN", "attachment")]),
        owner_user_id: "owner-2",
        access: "public",
        content_asset_id: "asset-loser",
        now: t2,
      });
      assertEquals(attempt, { ok: false, reason: "managed_conflict" });
      assertEquals(await subject.find_page_aggregate_by_id("loser"), null);
      assertEquals(
        await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "free",
        }),
        null,
      );
      assertEquals(
        (await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "taken",
        }))?.page,
        winner,
      );
    },
  );

  conformance_test(
    "managed creation atomically retires every endpoint-occupying trial",
    async (subject) => {
      for (
        const asset_id of ["trial-a-asset", "trial-b-asset", "managed-asset"]
      ) {
        await create_asset(subject, asset_id);
      }
      for (
        const [page_id, page_name, asset_id] of [
          ["trial-a", "preview", "trial-a-asset"],
          ["trial-b", "download", "trial-b-asset"],
        ] as const
      ) {
        const trial = await subject.put_trial_page_aggregate({
          page_id,
          endpoint_set: endpoint_set(page_name),
          content_asset_id: asset_id,
          now: t1,
        });
        assert(trial.ok);
      }
      const managed = await subject.create_managed_page_aggregate({
        page_id: "managed",
        endpoint_set: endpoint_set("Preview", [
          binding("Download", "attachment"),
        ]),
        owner_user_id: "owner-1",
        access: "public",
        content_asset_id: "managed-asset",
        now: t2,
      });
      assert(managed.ok);
      assertEquals(managed.outcome, "replaced_trial");
      assertEquals(await subject.find_page_aggregate_by_id("trial-a"), null);
      assertEquals(await subject.find_page_aggregate_by_id("trial-b"), null);
      for (const page_name of ["preview", "download"]) {
        assertEquals(
          (await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }))
            ?.page.page_id,
          "managed",
        );
      }
      assert(
        (await subject.find_content_asset_by_id("trial-a-asset")) !== null,
      );
      assert(
        (await subject.find_content_asset_by_id("trial-b-asset")) !== null,
      );
    },
  );

  conformance_test(
    "concurrent overlapping creates have one complete winner",
    async (subject) => {
      await create_asset(subject, "asset-a");
      await create_asset(subject, "asset-b");
      const requests = [
        {
          page_id: "page-a",
          endpoint_set: endpoint_set("shared", [
            binding("only-a", "attachment"),
          ]),
          owner_user_id: "owner-a",
          access: "public" as const,
          content_asset_id: "asset-a",
          now: t1,
        },
        {
          page_id: "page-b",
          endpoint_set: endpoint_set("shared", [
            binding("only-b", "attachment"),
          ]),
          owner_user_id: "owner-b",
          access: "public" as const,
          content_asset_id: "asset-b",
          now: t1,
        },
      ];
      const results = await Promise.all(
        requests.map((request) =>
          subject.create_managed_page_aggregate(request)
        ),
      );
      assertEquals(only_ok(results).length, 1);
      assertEquals(
        results.filter((result) => !result.ok).map((result) => result.reason),
        ["managed_conflict"],
      );
      const winner = only_ok(results)[0].page;
      assertEquals(
        (await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "shared",
        }))?.page.page_id,
        winner.page_id,
      );
      const winner_suffix = winner.page_id === "page-a" ? "a" : "b";
      const loser_suffix = winner_suffix === "a" ? "b" : "a";
      assertEquals(
        (await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: `only-${winner_suffix}`,
        }))?.page.page_id,
        winner.page_id,
      );
      assertEquals(
        await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: `only-${loser_suffix}`,
        }),
        null,
      );
    },
  );

  conformance_test(
    "endpoint replacement is revision-bound and all-or-none",
    async (subject) => {
      await create_asset(subject, "asset-source");
      await create_asset(subject, "asset-protected");
      const source = await create_managed(
        subject,
        "source",
        "asset-source",
        endpoint_set("old-preview", [binding("old-download", "attachment")]),
      );
      await create_managed(
        subject,
        "protected",
        "asset-protected",
        endpoint_set("protected"),
      );
      assertEquals(
        await subject.update_managed_page_aggregate({
          page_id: "source",
          owner_user_id: "owner-1",
          expected_revision: 1,
          patch: {
            endpoint_set: endpoint_set("new-preview", [
              binding("PROTECTED", "attachment"),
            ]),
          },
          now: t2,
        }),
        { ok: false, reason: "endpoint_conflict" },
      );
      assertEquals(await subject.find_page_aggregate_by_id("source"), source);
      for (const page_name of ["old-preview", "old-download"]) {
        assertEquals(
          (await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }))
            ?.page.page_id,
          "source",
        );
      }
      assertEquals(
        await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "new-preview",
        }),
        null,
      );

      const updated = await subject.update_managed_page_aggregate({
        page_id: "source",
        owner_user_id: "owner-1",
        expected_revision: 1,
        patch: {
          endpoint_set: endpoint_set("New-Preview", [
            binding("New-Download", "attachment"),
          ]),
        },
        now: t2,
      });
      assert(updated.ok);
      assertEquals(updated.page.revision, 2);
      assertEquals(
        updated.page.endpoint_set.canonical.locator.page_name,
        "New-Preview",
      );
      for (const page_name of ["old-preview", "old-download"]) {
        assertEquals(
          await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }),
          null,
        );
      }
      for (const page_name of ["new-preview", "new-download"]) {
        assertEquals(
          (await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }))
            ?.page,
          updated.page,
        );
      }
    },
  );

  conformance_test(
    "content replacement flips one shared asset reference and retains old bytes",
    async (subject) => {
      await create_asset(subject, "asset-old", "old");
      await create_asset(subject, "asset-new", "new");
      await create_managed(
        subject,
        "page-1",
        "asset-old",
        endpoint_set("preview", [binding("download", "attachment")]),
      );
      const updated = await subject.update_managed_page_aggregate({
        page_id: "page-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
        patch: { content_asset_id: "asset-new" },
        now: t2,
      });
      assert(updated.ok);
      assertEquals(updated.page.content_asset_id, "asset-new");
      for (const page_name of ["preview", "download"]) {
        assertEquals(
          (await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }))
            ?.page.content_asset_id,
          "asset-new",
        );
      }
      assertEquals(
        (await subject.find_content_asset_by_id("asset-old"))?.data,
        { marker: "old" },
      );
      assertEquals(
        (await subject.find_content_asset_by_id("asset-new"))?.data,
        { marker: "new" },
      );
    },
  );

  conformance_test(
    "access and tags change once without changing endpoints or asset",
    async (subject) => {
      await create_asset(subject, "asset-1");
      const created = await create_managed(
        subject,
        "page-1",
        "asset-1",
        endpoint_set("preview", [binding("download", "attachment")]),
      );
      const updated = await subject.update_managed_page_aggregate({
        page_id: "page-1",
        owner_user_id: "owner-1",
        expected_revision: 1,
        patch: { access: "private", tags: ["archive", "reference"] },
        now: t2,
      });
      assert(updated.ok);
      assertEquals(updated.page, {
        ...created,
        access: "private",
        tags: ["archive", "reference"],
        revision: 2,
        updated_at: t2,
      });
      for (const page_name of ["preview", "download"]) {
        assertEquals(
          (await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }))
            ?.page,
          updated.page,
        );
      }
    },
  );

  conformance_test(
    "managed mutation is owner-nondisclosing and exact-revision-bound",
    async (subject) => {
      await create_asset(subject, "asset-1");
      const created = await create_managed(
        subject,
        "page-1",
        "asset-1",
        endpoint_set("page"),
      );
      assertEquals(
        await subject.update_managed_page_aggregate({
          page_id: "page-1",
          owner_user_id: "owner-2",
          expected_revision: 1,
          patch: { access: "private" },
          now: t2,
        }),
        { ok: false, reason: "not_found" },
      );
      assertEquals(
        await subject.update_managed_page_aggregate({
          page_id: "page-1",
          owner_user_id: "owner-1",
          expected_revision: 2,
          patch: { access: "private" },
          now: t2,
        }),
        { ok: false, reason: "revision_conflict" },
      );
      assertEquals(await subject.find_page_aggregate_by_id("page-1"), created);
    },
  );

  conformance_test(
    "endpoint replacement and duplication stay in the source namespace",
    async (subject) => {
      await create_asset(subject, "asset-1");
      const source = await create_managed(
        subject,
        "source",
        "asset-1",
        endpoint_set("source"),
      );
      await assertRejects(
        () =>
          subject.update_managed_page_aggregate({
            page_id: "source",
            owner_user_id: "owner-1",
            expected_revision: 1,
            patch: { endpoint_set: endpoint_set("moved", [], "Bob") },
            now: t2,
          }),
        Error,
        "current namespace",
      );
      await assertRejects(
        () =>
          subject.duplicate_managed_page_aggregate({
            source_page_id: "source",
            owner_user_id: "owner-1",
            expected_revision: 1,
            page_id: "copy",
            endpoint_set: endpoint_set("copy", [], "Bob"),
            now: t2,
          }),
        Error,
        "source namespace",
      );
      assertEquals(await subject.find_page_aggregate_by_id("source"), source);
      assertEquals(await subject.find_page_aggregate_by_id("copy"), null);
      assertEquals(
        await subject.resolve_page_endpoint({
          namespace: "bob",
          page_name: "moved",
        }),
        null,
      );
    },
  );

  conformance_test(
    "duplicate gets fresh page/endpoints while sharing the immutable asset",
    async (subject) => {
      await create_asset(subject, "asset-1", "shared");
      const source = await create_managed(
        subject,
        "source",
        "asset-1",
        endpoint_set("source-preview", [
          binding("source-download", "attachment"),
        ]),
        "private",
      );
      const duplicated = await subject.duplicate_managed_page_aggregate({
        source_page_id: "source",
        owner_user_id: "owner-1",
        expected_revision: 1,
        page_id: "copy",
        endpoint_set: endpoint_set("copy-preview", [
          binding("copy-download", "attachment"),
        ]),
        now: t2,
      });
      assert(duplicated.ok);
      assertEquals(duplicated.page.page_id, "copy");
      assertEquals(duplicated.page.content_asset_id, source.content_asset_id);
      assertEquals(duplicated.page.revision, 1);
      assertEquals(duplicated.page.access, "private");
      assertEquals(duplicated.page.tags, ["reference"]);
      assertEquals(await subject.find_page_aggregate_by_id("source"), source);
      for (const page_name of ["copy-preview", "copy-download"]) {
        assertEquals(
          (await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }))
            ?.page.page_id,
          "copy",
        );
      }
    },
  );

  conformance_test(
    "trial replacement moves its complete endpoint set and preserves identity",
    async (subject) => {
      await create_asset(subject, "asset-old");
      await create_asset(subject, "asset-new");
      const first = await subject.put_trial_page_aggregate({
        page_id: "trial-1",
        endpoint_set: endpoint_set("one", [binding("two", "attachment")]),
        content_asset_id: "asset-old",
        now: t1,
      });
      assert(first.ok);
      const replaced = await subject.put_trial_page_aggregate({
        page_id: "ignored-generated-id",
        endpoint_set: endpoint_set("TWO", [binding("three", "attachment")]),
        content_asset_id: "asset-new",
        now: t2,
      });
      assert(replaced.ok);
      assertEquals(replaced.outcome, "replaced");
      assertEquals(replaced.page.page_id, "trial-1");
      assertEquals(replaced.page.revision, 2);
      assertEquals(replaced.page.created_at, t1);
      assertEquals(
        await subject.find_page_aggregate_by_id("ignored-generated-id"),
        null,
      );
      assertEquals(
        await subject.resolve_page_endpoint({
          namespace: "alice",
          page_name: "one",
        }),
        null,
      );
      for (const page_name of ["two", "three"]) {
        assertEquals(
          (await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }))
            ?.page,
          replaced.page,
        );
      }
    },
  );

  conformance_test(
    "management and public queries return each logical page once",
    async (subject) => {
      for (const asset_id of ["asset-public", "asset-private", "asset-trial"]) {
        await create_asset(subject, asset_id);
      }
      await create_managed(
        subject,
        "public-page",
        "asset-public",
        endpoint_set("Preview", [binding("Download", "attachment")]),
      );
      await create_managed(
        subject,
        "private-page",
        "asset-private",
        endpoint_set("Private"),
        "private",
      );
      const trial = await subject.put_trial_page_aggregate({
        page_id: "trial-page",
        endpoint_set: endpoint_set("Trial"),
        content_asset_id: "asset-trial",
        now: t1,
      });
      assert(trial.ok);

      const managed = await subject.list_managed_page_aggregates({
        owner_user_id: "owner-1",
        namespace: "ALICE",
        page_name_query: "view",
        access: "public",
        tag: "reference",
        limit: 10,
      });
      assert(managed.ok);
      assertEquals(managed.pages.map((page) => page.page_id), ["public-page"]);
      assertEquals(managed.next_cursor, null);

      const listed = await subject.list_public_page_aggregates({
        namespace: "alice",
        limit: 10,
      });
      assert(listed.ok);
      assertEquals(listed.pages.map((page) => page.page_id), ["public-page"]);

      const explored = await subject.explore_public_page_aggregates({
        namespace_query: "ali",
        page_name_query: "preview",
        tag: "reference",
        limit: 10,
      });
      assert(explored.ok);
      assertEquals(explored.pages.map((page) => page.page_id), ["public-page"]);
      assertEquals(
        await subject.list_public_page_aggregates({
          namespace: "alice",
          limit: 10,
          cursor: "invalid",
        }),
        { ok: false, reason: "invalid_cursor" },
      );
    },
  );

  conformance_test(
    "delete removes every endpoint while retaining a potentially shared asset",
    async (subject) => {
      await create_asset(subject, "asset-1", "retained");
      await create_managed(
        subject,
        "page-1",
        "asset-1",
        endpoint_set("preview", [binding("download", "attachment")]),
      );
      assertEquals(
        await subject.delete_managed_page_aggregate({
          page_id: "page-1",
          owner_user_id: "owner-1",
          expected_revision: 1,
        }),
        { ok: true },
      );
      assertEquals(await subject.find_page_aggregate_by_id("page-1"), null);
      for (const page_name of ["preview", "download"]) {
        assertEquals(
          await subject.resolve_page_endpoint({
            namespace: "alice",
            page_name,
          }),
          null,
        );
      }
      assertEquals(
        (await subject.find_content_asset_by_id("asset-1"))?.data,
        { marker: "retained" },
      );
    },
  );
}
