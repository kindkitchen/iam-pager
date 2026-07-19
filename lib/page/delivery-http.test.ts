import { assertEquals } from "@std/assert";
import type { Session } from "../session/model.ts";
import { page_actor_from_session } from "./delivery-http.ts";

Deno.test("direct delivery actor derives only from resolved session authority", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const guest: Session = {
    kind: "guest",
    session_id: "guest-session",
    session_version: 1,
    created_at: now,
    last_seen_at: now,
    absolute_expires_at: new Date("2026-07-26T12:00:00.000Z"),
  };
  const creator: Session = {
    ...guest,
    kind: "authenticated",
    user_id: "owner-1",
    authenticated_at: now,
    idle_expires_at: new Date("2026-08-18T12:00:00.000Z"),
    csrf_token: "c".repeat(43),
  };

  assertEquals(page_actor_from_session(guest), { kind: "guest" });
  assertEquals(page_actor_from_session(creator), {
    kind: "user",
    user_id: "owner-1",
  });
});
