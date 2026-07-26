import { assertEquals } from "@std/assert";
import type { Session } from "../session/model.ts";
import {
  is_current_destination,
  SessionSiteMapReader,
  site_map,
  site_map_reader,
} from "./site-map.ts";

const guest_session: Session = {
  kind: "guest",
  session_id: "session-1",
  session_version: 1,
  created_at: new Date("2026-07-18T12:00:00.000Z"),
  last_seen_at: new Date("2026-07-18T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-07-25T12:00:00.000Z"),
};

const creator_session: Session = {
  ...guest_session,
  kind: "authenticated",
  user_id: "user-private-id",
  authenticated_at: new Date("2026-07-18T12:01:00.000Z"),
  idle_expires_at: new Date("2026-08-17T12:01:00.000Z"),
  csrf_token: "c".repeat(43),
};

Deno.test("guests see public and guest-only destinations", () => {
  assertEquals(
    site_map_reader.visible(guest_session).map((entry) => entry.id),
    ["home", "publish", "explore", "demo", "about", "invite"],
  );
});

Deno.test("creators see creator destinations instead of the invitation", () => {
  assertEquals(
    site_map_reader.visible(creator_session).map((entry) => entry.id),
    ["home", "publish", "manage", "explore", "demo", "about", "api_keys"],
  );
});

Deno.test("every destination is reachable from navigation or the hub", () => {
  const unreachable = site_map.filter((destination) =>
    !destination.in_navigation && !destination.in_hub
  );
  assertEquals(unreachable.map((destination) => destination.id), []);
});

Deno.test("current destination ignores a trailing slash and root aliases", () => {
  const reader = new SessionSiteMapReader();
  const home = reader.destination("home");
  const publish = reader.destination("publish");
  assertEquals(is_current_destination(home, "/"), true);
  assertEquals(is_current_destination(home, "/site/"), true);
  assertEquals(is_current_destination(home, "/site/publish"), false);
  assertEquals(is_current_destination(publish, "/site/publish/"), true);
  assertEquals(is_current_destination(publish, "/site/publishing"), false);
});
