import { assert, assertEquals } from "@std/assert";
import {
  api_key_authenticates,
  api_key_label_max_length,
  api_key_metadata,
  api_key_status,
  type ApiKeyRecord,
  is_valid_api_key_label,
  is_well_formed_bearer,
  normalize_api_key_permissions,
  sort_api_key_metadata,
} from "./model.ts";

const now = new Date("2026-07-22T12:00:00.000Z");

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    api_key_id: "key-1",
    owner_user_id: "user-1",
    label: "automation",
    permissions: ["read"],
    secret_hash: "a".repeat(64),
    created_at: now,
    updated_at: now,
    expires_at: null,
    revision: 1,
    ...overrides,
  };
}

Deno.test("label validation bounds length and rejects control characters", () => {
  assert(is_valid_api_key_label("a"));
  assert(is_valid_api_key_label("a".repeat(api_key_label_max_length)));
  assert(!is_valid_api_key_label(""));
  assert(!is_valid_api_key_label("a".repeat(api_key_label_max_length + 1)));
  assert(!is_valid_api_key_label("line\nbreak"));
  assert(!is_valid_api_key_label("null\x00byte"));
});

Deno.test("permission normalization expands all and keeps canonical order", () => {
  assertEquals(normalize_api_key_permissions(["all"]), {
    ok: true,
    permissions: ["read", "write", "delete"],
  });
  assertEquals(normalize_api_key_permissions(["delete", "read"]), {
    ok: true,
    permissions: ["read", "delete"],
  });
});

Deno.test("permission normalization rejects invalid shapes", () => {
  for (
    const input of [
      [],
      ["all", "read"],
      ["read", "read"],
      ["admin"],
      ["READ"],
    ]
  ) {
    assert(!normalize_api_key_permissions(input).ok, JSON.stringify(input));
  }
});

Deno.test("bearer well-formedness is a fixed prefix plus 43 base64url chars", () => {
  assert(is_well_formed_bearer(`iamp_${"A".repeat(43)}`));
  assert(!is_well_formed_bearer(`iamp_${"A".repeat(42)}`));
  assert(!is_well_formed_bearer(`iamp_${"A".repeat(44)}`));
  assert(!is_well_formed_bearer(`iamp_${"A".repeat(42)}+`));
  assert(!is_well_formed_bearer("A".repeat(48)));
  assert(!is_well_formed_bearer(""));
});

Deno.test("status derives from expiry against the supplied clock", () => {
  assertEquals(api_key_status(record(), now), "active");
  const later = new Date("2026-07-23T12:00:00.000Z");
  assertEquals(api_key_status(record({ expires_at: later }), now), "active");
  assertEquals(api_key_status(record({ expires_at: now }), now), "expired");
  assert(!api_key_authenticates(record({ expires_at: now }), now));
  assert(api_key_authenticates(record({ expires_at: later }), now));
});

Deno.test("metadata carries no secret material", () => {
  const metadata = api_key_metadata(record(), now);
  assert(!("secret_hash" in metadata));
  assertEquals(metadata.status, "active");
  assertEquals(metadata.revision, 1);
});

Deno.test("sorting is oldest first, then ID", () => {
  const early = new Date("2026-07-22T10:00:00.000Z");
  const keys = [
    api_key_metadata(record({ api_key_id: "b", created_at: now }), now),
    api_key_metadata(record({ api_key_id: "c", created_at: early }), now),
    api_key_metadata(record({ api_key_id: "a", created_at: early }), now),
  ];
  assertEquals(
    sort_api_key_metadata(keys).map((key) => key.api_key_id),
    ["a", "c", "b"],
  );
});
