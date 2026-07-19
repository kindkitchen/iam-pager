import { assert, assertEquals } from "@std/assert";
import type { ContentRepository } from "./interfaces.ts";
import type { PageRecord } from "./model.ts";

export interface ContentRepositoryConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  name: string;
  /** Must return a fresh, empty repository for every test. */
  make_repository: () => ContentRepository | Promise<ContentRepository>;
  /** Optional per-test cleanup (close connections, drop state). */
  teardown?: (repository: ContentRepository) => void | Promise<void>;
}

export function make_conformance_page(
  namespace: string,
  page_name: string | undefined,
  marker: string,
): PageRecord {
  return {
    locator: page_name === undefined ? { namespace } : { namespace, page_name },
    content: {
      content_type: "md-page",
      data: { md: marker, html: `<p>${marker}</p>` },
      meta: { media_type: "text/html; charset=utf-8", size_bytes: 0 },
      created_at: new Date("2026-07-18T00:00:00.000Z"),
      updated_at: new Date("2026-07-18T00:00:00.000Z"),
    },
  };
}

/**
 * Implementation-agnostic conformance suite for `ContentRepository`
 * (DA-LOCATOR, DA-CONTENT): registers the contract's case-insensitive
 * identity, replacement, and round-trip rules as Deno tests against any
 * backend. Durable implementations reuse it unchanged with their own factory.
 */
export function test_content_repository_conformance(
  options: ContentRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: ContentRepository) => Promise<void>,
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

  conformance_test("get of an unknown locator returns null", async (
    repository,
  ) => {
    assertEquals(await repository.get({ namespace: "ns" }), null);
    assertEquals(
      await repository.get({ namespace: "ns", page_name: "page" }),
      null,
    );
  });

  conformance_test(
    "put round-trips the full record, dates and meta included",
    async (repository) => {
      const page: PageRecord = {
        locator: { namespace: "Round", page_name: "Trip" },
        content: {
          content_type: "md-page",
          data: { md: "# Title", html: "<h1>Title</h1>" },
          meta: {
            media_type: "text/html; charset=utf-8",
            size_bytes: 7,
            download_filename: "trip.html",
          },
          created_at: new Date("2026-07-18T01:02:03.004Z"),
          updated_at: new Date("2026-07-18T05:06:07.008Z"),
        },
      };
      await repository.put(page);
      assertEquals(await repository.get({ namespace: "round" }), null);
      assertEquals(
        await repository.get({ namespace: "Round", page_name: "Trip" }),
        page,
      );
    },
  );

  conformance_test(
    "lookup is case-insensitive, stored casing is preserved",
    async (repository) => {
      await repository.put(make_conformance_page("MyNs", "MyPage", "v1"));
      for (
        const locator of [
          { namespace: "myns", page_name: "mypage" },
          { namespace: "MYNS", page_name: "MYPAGE" },
          { namespace: "MyNs", page_name: "MyPage" },
        ]
      ) {
        const found = await repository.get(locator);
        assertEquals(found?.locator, {
          namespace: "MyNs",
          page_name: "MyPage",
        });
      }
    },
  );

  conformance_test(
    "put replaces the page at the same case-insensitive locator",
    async (repository) => {
      await repository.put(make_conformance_page("ns", "page", "v1"));
      await repository.put(make_conformance_page("NS", "PAGE", "v2"));
      const found = await repository.get({
        namespace: "ns",
        page_name: "page",
      });
      assertEquals(found?.content.data, { md: "v2", html: "<p>v2</p>" });
      assertEquals(found?.locator, { namespace: "NS", page_name: "PAGE" });
    },
  );

  conformance_test("default page and named page do not collide", async (
    repository,
  ) => {
    await repository.put(make_conformance_page("ns", undefined, "default"));
    await repository.put(make_conformance_page("ns", "page", "named"));
    assertEquals(
      ((await repository.get({ namespace: "ns" }))?.content.data as {
        md: string;
      }).md,
      "default",
    );
    assertEquals(
      ((await repository.get({ namespace: "ns", page_name: "page" }))?.content
        .data as { md: string }).md,
      "named",
    );
  });

  conformance_test(
    "delete removes the page and reports whether it existed",
    async (repository) => {
      await repository.put(make_conformance_page("ns", "page", "v1"));
      assertEquals(
        await repository.delete({ namespace: "NS", page_name: "Page" }),
        true,
      );
      assertEquals(
        await repository.get({ namespace: "ns", page_name: "page" }),
        null,
      );
      assertEquals(
        await repository.delete({ namespace: "ns", page_name: "page" }),
        false,
      );
    },
  );

  conformance_test("put after delete stores the new record", async (
    repository,
  ) => {
    await repository.put(make_conformance_page("ns", "page", "v1"));
    await repository.delete({ namespace: "ns", page_name: "page" });
    await repository.put(make_conformance_page("ns", "page", "v2"));
    const found = await repository.get({ namespace: "ns", page_name: "page" });
    assertEquals((found?.content.data as { md: string }).md, "v2");
  });

  conformance_test(
    "content larger than one storage value round-trips exactly",
    async (repository) => {
      const md = "M".repeat(200 * 1024) + "-end";
      const html = `<p>${"H".repeat(150 * 1024)}</p>`;
      const page: PageRecord = {
        locator: { namespace: "big", page_name: "page" },
        content: {
          content_type: "md-page",
          data: { md, html },
          meta: { media_type: "text/html; charset=utf-8", size_bytes: 0 },
          created_at: new Date("2026-07-18T00:00:00.000Z"),
          updated_at: new Date("2026-07-18T00:00:00.000Z"),
        },
      };
      await repository.put(page);
      assertEquals(
        await repository.get({ namespace: "big", page_name: "page" }),
        page,
      );
    },
  );

  conformance_test(
    "replacement swaps between small and large content without residue",
    async (repository) => {
      const large = make_conformance_page("ns", "page", "L".repeat(120 * 1024));
      const small = make_conformance_page("ns", "page", "small");
      await repository.put(large);
      await repository.put(small);
      assertEquals(
        await repository.get({ namespace: "ns", page_name: "page" }),
        small,
      );
      await repository.put(large);
      assertEquals(
        await repository.get({ namespace: "ns", page_name: "page" }),
        large,
      );
    },
  );

  conformance_test(
    "concurrent puts of one locator settle on one complete record",
    async (repository) => {
      const markers = ["a", "b", "c", "d", "e"];
      await Promise.all(
        markers.map((marker) =>
          repository.put(
            make_conformance_page("Race", "Page", marker.repeat(60 * 1024)),
          )
        ),
      );
      const found = await repository.get({
        namespace: "race",
        page_name: "page",
      });
      assert(found !== null);
      const data = found.content.data as { md: string; html: string };
      const winner = markers.find((marker) =>
        data.md === marker.repeat(60 * 1024)
      );
      assert(winner !== undefined, "stored md must equal one racer's md");
      assertEquals(data.html, `<p>${winner.repeat(60 * 1024)}</p>`);
    },
  );
}
