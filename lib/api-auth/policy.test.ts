import { assertEquals } from "@std/assert";
import type { ApiKeyPermission } from "../api-key/mod.ts";
import type { ApiPrincipal } from "./model.ts";
import { PermissionApiOperationPolicy } from "./policy.ts";

const policy = new PermissionApiOperationPolicy();
const csrf_token = "c".repeat(43);

const guest: ApiPrincipal = { kind: "guest" };
const browser_user: ApiPrincipal = {
  kind: "browser_user",
  user_id: "user-1",
  csrf_token,
};

function key(permissions: ApiKeyPermission[]): ApiPrincipal {
  return {
    kind: "api_key",
    api_key_id: "key-1",
    user_id: "user-1",
    permissions,
  };
}

const all_permissions: ApiKeyPermission[] = ["read", "write", "delete"];

Deno.test("a guest principal is never authorized", () => {
  for (const permission of all_permissions) {
    assertEquals(
      policy.authorize(guest, { permission, presented_csrf_token: csrf_token }),
      { ok: false, reason: "not_authenticated" },
    );
  }
});

Deno.test("a browser user reads without CSRF and holds every permission", () => {
  assertEquals(policy.authorize(browser_user, { permission: "read" }), {
    ok: true,
    user_id: "user-1",
  });
  for (const permission of ["write", "delete"] as ApiKeyPermission[]) {
    assertEquals(
      policy.authorize(browser_user, {
        permission,
        presented_csrf_token: csrf_token,
      }),
      { ok: true, user_id: "user-1" },
    );
  }
});

Deno.test("browser mutations require the exact synchronizer token", () => {
  for (const permission of ["write", "delete"] as ApiKeyPermission[]) {
    for (const presented of [undefined, null, "", "d".repeat(43), "c"]) {
      assertEquals(
        policy.authorize(browser_user, {
          permission,
          presented_csrf_token: presented,
        }),
        { ok: false, reason: "invalid_csrf" },
      );
    }
  }
});

Deno.test("key principals need the mapped permission and never CSRF", () => {
  for (const permission of all_permissions) {
    assertEquals(
      policy.authorize(key([permission]), { permission }),
      { ok: true, user_id: "user-1" },
    );
    assertEquals(
      policy.authorize(
        key(all_permissions.filter((granted) => granted !== permission)),
        { permission, presented_csrf_token: csrf_token },
      ),
      { ok: false, reason: "insufficient_permission" },
    );
  }
});

Deno.test("a full-permission key passes every operation", () => {
  for (const permission of all_permissions) {
    assertEquals(
      policy.authorize(key(all_permissions), { permission }),
      { ok: true, user_id: "user-1" },
    );
  }
});
