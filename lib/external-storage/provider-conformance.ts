import { assertEquals, assertExists } from "@std/assert";
import type { ExternalStorageProvider } from "./interfaces.ts";
import type { ExternalContentPutInput, ExternalContentRef } from "./model.ts";
import { ExternalStorageProviderRegistry } from "./provider-registry.ts";

export interface ExternalStorageProviderConformanceFixture {
  readonly provider: ExternalStorageProvider;
  readonly existing_ref: ExternalContentRef;
  readonly existing_body: Uint8Array;
  readonly missing_ref: ExternalContentRef;
  /** Must normalize fetch and stat to `external_source_unreachable`. */
  readonly unreachable_ref: ExternalContentRef;
  /** Required when the provider declares `write`. */
  readonly put_input?: ExternalContentPutInput;
}

export interface ExternalStorageProviderConformanceOptions {
  /** Implementation name used as the test-name prefix. */
  readonly name: string;
  /** Must return an isolated fixture for every test. */
  readonly make_fixture: () =>
    | ExternalStorageProviderConformanceFixture
    | Promise<ExternalStorageProviderConformanceFixture>;
  readonly teardown?: (
    fixture: ExternalStorageProviderConformanceFixture,
  ) => void | Promise<void>;
}

/** Registers the normalized read/write/delete provider contract. */
export function test_external_storage_provider_conformance(
  options: ExternalStorageProviderConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (
      fixture: ExternalStorageProviderConformanceFixture,
    ) => Promise<void>,
  ) => {
    Deno.test(`${options.name}: ${label}`, async () => {
      const fixture = await options.make_fixture();
      try {
        await run(fixture);
      } finally {
        await options.teardown?.(fixture);
      }
    });
  };

  conformance_test(
    "registers a coherent mandatory read contract",
    (fixture) => {
      const registry = new ExternalStorageProviderRegistry([fixture.provider]);
      assertEquals(
        registry.resolve(fixture.provider.provider_id),
        fixture.provider,
      );
      return Promise.resolve();
    },
  );

  conformance_test("fetches complete isolated content within its bound", async (
    fixture,
  ) => {
    const result = await fixture.provider.fetch_content({
      content_ref: fixture.existing_ref,
      max_bytes: fixture.existing_body.byteLength,
    });
    assertEquals(result.ok, true);
    if (!result.ok) return;
    assertEquals(result.value.body, fixture.existing_body);
    assertEquals(
      result.value.stat.size_bytes,
      fixture.existing_body.byteLength,
    );

    if (result.value.body.byteLength > 0) result.value.body[0] ^= 0xff;
    const fetched_again = await fixture.provider.fetch_content({
      content_ref: fixture.existing_ref,
      max_bytes: fixture.existing_body.byteLength,
    });
    assertEquals(fetched_again.ok, true);
    if (fetched_again.ok) {
      assertEquals(fetched_again.value.body, fixture.existing_body);
    }
  });

  conformance_test("refuses content larger than the caller bound", async (
    fixture,
  ) => {
    if (fixture.existing_body.byteLength === 0) return;
    assertEquals(
      await fixture.provider.fetch_content({
        content_ref: fixture.existing_ref,
        max_bytes: fixture.existing_body.byteLength - 1,
      }),
      { ok: false, reason: "external_content_missing" },
    );
  });

  conformance_test("returns stat metadata matching fetched content", async (
    fixture,
  ) => {
    const fetched = await fixture.provider.fetch_content({
      content_ref: fixture.existing_ref,
      max_bytes: fixture.existing_body.byteLength,
    });
    const stated = await fixture.provider.stat_content(fixture.existing_ref);
    assertEquals(fetched.ok, true);
    assertEquals(stated.ok, true);
    if (fetched.ok && stated.ok) assertEquals(stated.value, fetched.value.stat);
  });

  conformance_test("normalizes absent content as definitive missing", async (
    fixture,
  ) => {
    assertEquals(
      await fixture.provider.fetch_content({
        content_ref: fixture.missing_ref,
        max_bytes: 1024,
      }),
      { ok: false, reason: "external_content_missing" },
    );
    assertEquals(
      await fixture.provider.stat_content(fixture.missing_ref),
      { ok: false, reason: "external_content_missing" },
    );
  });

  conformance_test(
    "normalizes retryable provider failures as unreachable",
    async (
      fixture,
    ) => {
      assertEquals(
        await fixture.provider.fetch_content({
          content_ref: fixture.unreachable_ref,
          max_bytes: 1024,
        }),
        { ok: false, reason: "external_source_unreachable" },
      );
      assertEquals(
        await fixture.provider.stat_content(fixture.unreachable_ref),
        { ok: false, reason: "external_source_unreachable" },
      );
    },
  );

  conformance_test("writes content exactly when write is declared", async (
    fixture,
  ) => {
    if (!fixture.provider.capabilities.includes("write")) {
      assertEquals(fixture.provider.put_content, undefined);
      return;
    }
    assertExists(fixture.provider.put_content);
    assertExists(fixture.put_input);
    const written = await fixture.provider.put_content(fixture.put_input);
    assertEquals(written.ok, true);
    if (!written.ok) return;
    assertEquals(written.value.provider_id, fixture.provider.provider_id);
    assertEquals(
      written.value.connection_id,
      fixture.put_input.connection_id,
    );
    assertEquals(
      await fixture.provider.fetch_content({
        content_ref: written.value,
        max_bytes: fixture.put_input.body.byteLength,
      }),
      {
        ok: true,
        value: {
          body: fixture.put_input.body,
          stat: {
            size_bytes: fixture.put_input.body.byteLength,
            ...(written.value.version_hint === undefined
              ? {}
              : { version_hint: written.value.version_hint }),
          },
        },
      },
    );
  });

  conformance_test(
    "deletes only explicit objects when delete is declared",
    async (
      fixture,
    ) => {
      if (!fixture.provider.capabilities.includes("delete")) {
        assertEquals(fixture.provider.delete_content, undefined);
        return;
      }
      assertExists(fixture.provider.delete_content);
      assertEquals(
        await fixture.provider.delete_content(fixture.existing_ref),
        { ok: true, value: undefined },
      );
      assertEquals(
        await fixture.provider.fetch_content({
          content_ref: fixture.existing_ref,
          max_bytes: fixture.existing_body.byteLength,
        }),
        { ok: false, reason: "external_content_missing" },
      );
    },
  );
}
