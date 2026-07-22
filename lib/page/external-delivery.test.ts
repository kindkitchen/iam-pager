import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { ContentAsset } from "../content/asset.ts";
import { MdPageHandler } from "../content/md-page.ts";
import {
  type ExternalContentRef,
  type ExternalStorageProvider,
  ExternalStorageProviderRegistry,
  MemoryExternalStorageProvider,
} from "../external-storage/mod.ts";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import type { PageClock } from "./interfaces.ts";
import { MemoryPageAggregateRepository } from "./memory-aggregate-repository.ts";
import { RepositoryNamespaceAuthorityResolver } from "./namespace-authority.ts";
import { PageService } from "./service.ts";

const detected_at = new Date("2026-07-22T12:00:00.000Z");
const ref: ExternalContentRef = {
  provider_id: "memory",
  connection_id: "connection-1",
  external_ref: "object-1",
  version_hint: "version-1",
};
const locator = { namespace: "Alice", page_name: "external" } as const;
const guest = { kind: "guest" } as const;
const text_encoder = new TextEncoder();
const external_body = text_encoder.encode(
  "<!doctype html><html><body><h1>External</h1></body></html>",
);

class FixedClock implements PageClock {
  now(): Date {
    return new Date(detected_at);
  }
}

class FailingHealthRepository extends MemoryPageAggregateRepository {
  override update_external_content_health(): Promise<never> {
    return Promise.reject(new Error("health storage unavailable"));
  }
}

async function digest(bytes: Uint8Array): Promise<string> {
  const value = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice()),
  );
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fixture(options: {
  provider?: ExternalStorageProvider;
  repository?: MemoryPageAggregateRepository;
  stored_body?: Uint8Array;
  expected_body?: Uint8Array;
} = {}) {
  const repository = options.repository ?? new MemoryPageAggregateRepository();
  const provider = options.provider ?? new MemoryExternalStorageProvider();
  if (provider instanceof MemoryExternalStorageProvider) {
    provider.seed_content(ref, options.stored_body ?? external_body);
  }
  const expected_body = options.expected_body ?? external_body;
  const asset: ContentAsset = {
    content_asset_id: "external-asset",
    content_type: "md-page",
    source: { kind: "external", ref },
    meta: {
      media_type: "text/html; charset=utf-8",
      size_bytes: expected_body.byteLength,
      sha256: await digest(expected_body),
      codec_version: "md-page-html-v1",
    },
    created_at: detected_at,
  };
  assert((await repository.create_content_asset(asset)).ok);
  const created = await repository.create_managed_page_aggregate({
    page_id: "external-page",
    endpoint_set: {
      canonical: { locator, delivery_profile: "inline" },
      alternates: [],
    },
    owner_user_id: "owner-1",
    access: "public",
    content_asset_id: asset.content_asset_id,
    now: detected_at,
  });
  assert(created.ok);
  const namespaces = new MemoryNamespaceRepository();
  await namespaces.reserve({
    namespace: locator.namespace,
    owner_user_id: "owner-1",
  });
  const service = new PageService({
    engine: new LocatorEngine({ strategies: [new PathSlugStrategy()] }),
    repository,
    namespace_authority: new RepositoryNamespaceAuthorityResolver(namespaces),
    handlers: [new MdPageHandler()],
    external_storage_providers: new ExternalStorageProviderRegistry([provider]),
    clock: new FixedClock(),
  });
  return { service, repository, provider };
}

Deno.test("PageService verifies and delivers external bytes with local metadata", async () => {
  const { service, repository } = await fixture();
  const delivered = await service.deliver(locator, guest);
  assert(delivered.ok);
  assertEquals(delivered.page.size_bytes, external_body.byteLength);
  assertEquals(delivered.payload.media_type, "text/html; charset=utf-8");
  assertEquals(delivered.payload.body, external_body);
  assertEquals(
    (await repository.find_page_aggregate_by_id("external-page"))
      ?.external_missing,
    undefined,
  );
  const viewed = await service.view_public(locator);
  assert(viewed.ok);
  assertStringIncludes(viewed.payload.body as string, "External");
  const listed = await service.list_public({ namespace: "Alice", limit: 10 });
  assert(listed.ok);
  assertEquals(listed.pages[0].size_bytes, external_body.byteLength);
});

Deno.test("PageService records definitive external loss and clears it after recovery", async () => {
  const { service, repository, provider } = await fixture();
  assert(provider instanceof MemoryExternalStorageProvider);
  provider.set_fault(ref, "external_content_missing");

  const missing = await service.deliver(locator, guest);
  assert(!missing.ok && missing.reason === "external_content_unavailable");
  assertEquals(missing.retry_after_seconds, undefined);
  assertStringIncludes(
    missing.payload.body as string,
    "temporarily unavailable",
  );
  assertEquals(
    (await repository.find_page_aggregate_by_id("external-page"))
      ?.external_missing,
    { cause: "external_content_missing", detected_at },
  );
  const viewed_missing = await service.view_public(locator);
  assert(
    !viewed_missing.ok &&
      viewed_missing.reason === "external_content_unavailable",
  );
  assertStringIncludes(
    viewed_missing.payload.body as string,
    "temporarily unavailable",
  );

  provider.set_fault(ref, null);
  const recovered = await service.deliver(locator, guest);
  assert(recovered.ok);
  assertEquals(recovered.payload.body, external_body);
  assertEquals(
    (await repository.find_page_aggregate_by_id("external-page"))
      ?.external_missing,
    undefined,
  );
});

Deno.test("PageService exposes, filters, and repairs owner external health", async () => {
  const { service, repository, provider } = await fixture();
  assert(provider instanceof MemoryExternalStorageProvider);
  provider.set_fault(ref, "external_content_missing");
  await service.deliver(locator, guest);

  const inspected = await service.inspect_managed({
    actor: { kind: "user", user_id: "owner-1" },
    page_id: "external-page",
  });
  assert(inspected.ok);
  assertEquals(inspected.page.external_missing, {
    cause: "external_content_missing",
    detected_at,
  });
  assertEquals(inspected.page.content, {
    content_type: "md-page",
    input: null,
    external_source: {
      provider_id: "memory",
      external_ref: "object-1",
    },
  });
  const broken = await service.list_managed({
    actor: { kind: "user", user_id: "owner-1" },
    external_missing: true,
    limit: 10,
  });
  assert(broken.ok);
  assertEquals(broken.pages.map((page) => page.page_id), ["external-page"]);
  const healthy = await service.list_managed({
    actor: { kind: "user", user_id: "owner-1" },
    external_missing: false,
    limit: 10,
  });
  assert(healthy.ok);
  assertEquals(healthy.pages, []);

  const replacement_ref = { ...ref, external_ref: "object-2" };
  provider.seed_content(replacement_ref, external_body);
  provider.set_fault(ref, null);
  const relinked = await service.relink_managed_external_content({
    actor: { kind: "user", user_id: "owner-1" },
    page_id: "external-page",
    expected_revision: 1,
    external_ref: replacement_ref.external_ref,
  });
  assert(relinked.ok);
  assertEquals(relinked.page.revision, 2);
  assertEquals(relinked.page.external_missing, undefined);
  assertEquals(relinked.page.content.external_source?.external_ref, "object-2");
  const relinked_page = await repository.find_page_aggregate_by_id(
    "external-page",
  );
  assert(relinked_page !== null);
  assertEquals(relinked_page.external_missing, undefined);
  assert(relinked_page.content_asset_id !== "external-asset");

  provider.set_fault(replacement_ref, "external_content_missing");
  await service.deliver(locator, guest);
  const detached = await service.update_managed({
    actor: { kind: "user", user_id: "owner-1" },
    page_id: "external-page",
    expected_revision: 2,
    patch: {
      content: { content_type: "md-page", input: { md: "# Restored inline" } },
    },
  });
  assert(detached.ok);
  assertEquals(detached.page.revision, 3);
  assertEquals(detached.page.external_missing, undefined);
  assertEquals(detached.page.content.input, { md: "# Restored inline" });
});

Deno.test("PageService rejects a non-identical external re-link", async () => {
  const { service, repository, provider } = await fixture();
  assert(provider instanceof MemoryExternalStorageProvider);
  const altered = external_body.slice();
  altered[altered.byteLength - 2] ^= 1;
  provider.seed_content({ ...ref, external_ref: "altered" }, altered);
  const result = await service.relink_managed_external_content({
    actor: { kind: "user", user_id: "owner-1" },
    page_id: "external-page",
    expected_revision: 1,
    external_ref: "altered",
  });
  assertEquals(result, { ok: false, reason: "external_content_mismatch" });
  assertEquals(
    (await repository.find_page_aggregate_by_id("external-page"))
      ?.content_asset_id,
    "external-asset",
  );
});

Deno.test("PageService distinguishes revoked, transient, and integrity failures", async () => {
  const revoked_fixture = await fixture();
  assert(
    revoked_fixture.provider instanceof MemoryExternalStorageProvider,
  );
  revoked_fixture.provider.set_fault(ref, "connection_revoked");
  const revoked = await revoked_fixture.service.deliver(locator, guest);
  assert(!revoked.ok && revoked.reason === "external_content_unavailable");
  assertEquals(
    (await revoked_fixture.repository.find_page_aggregate_by_id(
      "external-page",
    ))?.external_missing,
    { cause: "connection_revoked", detected_at },
  );

  const transient_fixture = await fixture();
  assert(
    transient_fixture.provider instanceof MemoryExternalStorageProvider,
  );
  transient_fixture.provider.set_fault(ref, "external_source_unreachable");
  const transient = await transient_fixture.service.deliver(locator, guest);
  assert(!transient.ok && transient.reason === "external_content_unavailable");
  assertEquals(
    (await transient_fixture.repository.find_page_aggregate_by_id(
      "external-page",
    ))?.external_missing,
    undefined,
  );

  const altered = external_body.slice();
  altered[altered.byteLength - 2] ^= 1;
  const integrity_fixture = await fixture({ stored_body: altered });
  const integrity = await integrity_fixture.service.deliver(locator, guest);
  assert(!integrity.ok && integrity.reason === "external_content_unavailable");
  assertEquals(
    (await integrity_fixture.repository.find_page_aggregate_by_id(
      "external-page",
    ))?.external_missing,
    { cause: "integrity_mismatch", detected_at },
  );
});

Deno.test("PageService keeps visitor outcomes independent from health-write failures", async () => {
  const repository = new FailingHealthRepository();
  const available_fixture = await fixture({ repository });
  assert((await available_fixture.service.deliver(locator, guest)).ok);

  assert(available_fixture.provider instanceof MemoryExternalStorageProvider);
  available_fixture.provider.set_fault(ref, "external_content_missing");
  const unavailable = await available_fixture.service.deliver(locator, guest);
  assert(
    !unavailable.ok && unavailable.reason === "external_content_unavailable",
  );
});

Deno.test("PageService treats an unregistered external provider as transient", async () => {
  const { repository } = await fixture();
  const service = new PageService({
    engine: new LocatorEngine({ strategies: [new PathSlugStrategy()] }),
    repository,
    namespace_authority: new RepositoryNamespaceAuthorityResolver(
      new MemoryNamespaceRepository(),
    ),
    handlers: [new MdPageHandler()],
    clock: new FixedClock(),
  });
  const unavailable = await service.deliver(locator, guest);
  assert(
    !unavailable.ok && unavailable.reason === "external_content_unavailable",
  );
  assertEquals(
    (await repository.find_page_aggregate_by_id("external-page"))
      ?.external_missing,
    undefined,
  );
});
