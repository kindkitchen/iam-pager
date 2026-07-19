import { assertEquals } from "@std/assert";
import { LocatorEngine } from "../locator/engine.ts";
import { PathSlugStrategy } from "../locator/path-slug-strategy.ts";
import { MemoryNamespaceRepository } from "../namespace/memory-repository.ts";
import { NamespaceReservationService } from "../namespace/service.ts";
import type { AuthenticatedSession, Session } from "../session/model.ts";
import { CreatorNamespacePanelPresenter } from "./namespace-panel.ts";

const now = new Date("2026-07-18T12:00:00.000Z");
const guest_session: Session = {
  kind: "guest",
  session_id: "session-1",
  session_version: 1,
  created_at: now,
  last_seen_at: now,
  absolute_expires_at: new Date("2026-07-25T12:00:00.000Z"),
};
const authenticated_session: AuthenticatedSession = {
  ...guest_session,
  kind: "authenticated",
  session_version: 3,
  user_id: "user-1",
  authenticated_at: now,
  idle_expires_at: new Date("2026-08-17T12:00:00.000Z"),
  absolute_expires_at: new Date("2026-10-16T12:00:00.000Z"),
  csrf_token: "c".repeat(43),
};

function make_presenter() {
  const engine = new LocatorEngine({ strategies: [new PathSlugStrategy()] });
  const namespaces = new NamespaceReservationService({
    engine,
    repository: new MemoryNamespaceRepository(),
  });
  return {
    presenter: new CreatorNamespacePanelPresenter({ namespaces, engine }),
    namespaces,
  };
}

Deno.test("panel stays hidden for guest sessions", async () => {
  const { presenter } = make_presenter();
  assertEquals(await presenter.present(guest_session), { kind: "hidden" });
});

Deno.test("panel exposes the session CSRF token and an empty list", async () => {
  const { presenter } = make_presenter();
  const panel = await presenter.present(authenticated_session);
  assertEquals(panel, {
    kind: "creator",
    csrf_token: authenticated_session.csrf_token,
    reservations: [],
  });
});

Deno.test("panel lists only the creator's reservations with paths", async () => {
  const { presenter, namespaces } = make_presenter();
  await namespaces.reserve({
    namespace: "Ada Lovelace",
    owner_user_id: "user-1",
  });
  await namespaces.reserve({ namespace: "other", owner_user_id: "user-2" });

  const panel = await presenter.present(authenticated_session);
  if (panel.kind !== "creator") throw new Error("expected a creator panel");
  assertEquals(panel.reservations.length, 1);
  assertEquals(panel.reservations[0].namespace, "Ada Lovelace");
  assertEquals(panel.reservations[0].path, "/Ada%20Lovelace");
  assertEquals(
    Number.isNaN(Date.parse(panel.reservations[0].reserved_at)),
    false,
  );
});
