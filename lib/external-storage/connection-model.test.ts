import { assertEquals } from "@std/assert";
import {
  is_storage_connection,
  is_storage_connection_credentials,
  max_storage_provider_subject_length,
  max_storage_scope_count,
  max_storage_scope_length,
  max_storage_token_length,
  storage_connection_credentials_violation,
  storage_connection_statuses,
  storage_connection_violation,
  type StorageConnection,
} from "./connection-model.ts";

function connection(
  overrides: Partial<StorageConnection> = {},
): StorageConnection {
  return {
    connection_id: "connection-1",
    user_id: "user-1",
    provider_id: "google-drive",
    provider_subject: "provider-subject",
    scopes: ["drive.file"],
    status: "active",
    created_at: new Date("2026-07-22T10:00:00.000Z"),
    updated_at: new Date("2026-07-22T10:00:00.000Z"),
    ...overrides,
  };
}

Deno.test("storage connection metadata is bounded and owner-safe", () => {
  assertEquals(storage_connection_statuses, ["active", "revoked"]);
  assertEquals(is_storage_connection(connection()), true);
  assertEquals(is_storage_connection(connection({ status: "revoked" })), true);
  assertEquals(
    storage_connection_violation({
      ...connection(),
      access_token: "must-not-enter-metadata",
    }),
    "storage connection contains unknown or missing fields",
  );
  assertEquals(
    storage_connection_violation(connection({ connection_id: "bad/id" })),
    "connection_id must be a route-safe opaque ID",
  );
  assertEquals(
    storage_connection_violation(connection({ provider_id: "Google" })),
    "provider_id must be a route-safe lowercase ID",
  );
  assertEquals(
    storage_connection_violation(connection({
      provider_subject: "x".repeat(max_storage_provider_subject_length + 1),
    })),
    "provider_subject must be non-empty bounded text without controls",
  );
  assertEquals(
    storage_connection_violation(connection({ scopes: [] })),
    "scopes must be a non-empty unique set of bounded values",
  );
  assertEquals(
    storage_connection_violation(connection({
      scopes: Array.from(
        { length: max_storage_scope_count + 1 },
        (_, index) => `scope-${String(index).padStart(2, "0")}`,
      ),
    })),
    "scopes must be a non-empty unique set of bounded values",
  );
  assertEquals(
    storage_connection_violation(connection({
      scopes: ["x".repeat(max_storage_scope_length + 1)],
    })),
    "scopes must be a non-empty unique set of bounded values",
  );
  assertEquals(
    storage_connection_violation(connection({ scopes: ["scope", "scope"] })),
    "scopes must be a non-empty unique set of bounded values",
  );
  assertEquals(
    storage_connection_violation(connection({
      created_at: new Date("2026-07-22T11:00:00.000Z"),
      updated_at: new Date("2026-07-22T10:00:00.000Z"),
    })),
    "updated_at must be a valid date not before created_at",
  );
});

Deno.test("storage credentials accept bounded server-only token material", () => {
  const credentials = {
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    access_token_expires_at: new Date("2026-07-22T12:00:00.000Z"),
  };
  assertEquals(is_storage_connection_credentials(credentials), true);
  assertEquals(
    is_storage_connection_credentials({ access_token: "access-secret" }),
    true,
  );
  assertEquals(
    storage_connection_credentials_violation({ access_token: "" }),
    "access_token must be non-empty bounded text",
  );
  assertEquals(
    storage_connection_credentials_violation({
      access_token: "x".repeat(max_storage_token_length + 1),
    }),
    "access_token must be non-empty bounded text",
  );
  assertEquals(
    storage_connection_credentials_violation({
      access_token: "access-secret",
      refresh_token: "",
    }),
    "refresh_token must be non-empty bounded text when present",
  );
  assertEquals(
    storage_connection_credentials_violation({
      access_token: "access-secret",
      access_token_expires_at: new Date(Number.NaN),
    }),
    "access_token_expires_at must be a valid date when present",
  );
});
