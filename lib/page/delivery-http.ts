import type { DeliveryProfile } from "../content/model.ts";
import type { LocatorEngine } from "../locator/engine.ts";
import type { Session } from "../session/model.ts";
import type { PageActor, PageDeliverer } from "./interfaces.ts";

/** Derives direct-delivery authority only from the resolved server session. */
export function page_actor_from_session(session: Session): PageActor {
  return session.kind === "authenticated"
    ? { kind: "user", user_id: session.user_id }
    : { kind: "guest" };
}

/** Maps a direct locator path to the raw page response without Fresh logic. */
export async function deliver_page_locator_path(
  engine: LocatorEngine,
  deliverer: PageDeliverer,
  pathname: string,
  actor: PageActor,
): Promise<Response> {
  const resolution = engine.resolve(pathname);
  if (!resolution.ok) {
    return resolution.reason === "invalid_segment"
      ? text_response(400, "invalid page URL")
      : text_response(404, "page not found");
  }
  const delivery = await deliverer.deliver(resolution.locator, actor);
  if (!delivery.ok) {
    return delivery.reason === "not_found"
      ? text_response(404, "page not found")
      : text_response(500, "page content is not deliverable");
  }
  const { endpoint, page, payload } = delivery;
  const headers = new Headers({
    "content-type": payload.media_type,
    "content-length": String(page.content.meta.size_bytes),
    "cache-control": "no-store",
    "content-disposition": content_disposition(
      endpoint.delivery_profile,
      payload.download_filename,
    ),
    "x-content-type-options": "nosniff",
  });
  if (is_active_content(payload.media_type)) {
    headers.set(
      "content-security-policy",
      "sandbox; default-src 'none'; img-src https: data:; " +
        "style-src 'unsafe-inline'",
    );
  }
  return new Response(payload.body as BodyInit, { status: 200, headers });
}

function is_active_content(media_type: string): boolean {
  const type = media_type.split(";", 1)[0].trim().toLowerCase();
  return type === "text/html" || type === "image/svg+xml";
}

function text_response(status: number, message: string): Response {
  return new Response(message + "\n", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function content_disposition(
  delivery_profile: DeliveryProfile,
  download_filename?: string,
): string {
  if (delivery_profile === "inline") return "inline";
  if (download_filename === undefined) return "attachment";
  const fallback = download_filename
    .replaceAll(/["\\\r\n]/g, "_")
    .replaceAll(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(download_filename).replaceAll(
    /['()*]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
