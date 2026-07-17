import type { LocatorEngine } from "../locator/engine.ts";
import type { PageDeliverer } from "./interfaces.ts";

/**
 * Map a request pathname to an intentional raw-delivery response
 * (CP-DELIVERY, QT-ROUTING). Every outcome carries an explicit status so
 * invalid or missing direct URLs never masquerade as a successful site
 * response:
 *
 * - malformed path segment -> 400
 * - non-locator path, forbidden namespace, missing page -> 404
 * - stored content type without a registered handler -> 500
 * - delivery -> 200 with media type, length, cache policy, and disposition
 *   taken from publish-time data.
 *
 * The web route stays a thin adapter over this function.
 */
export async function deliver_locator_path(
  engine: LocatorEngine,
  deliverer: PageDeliverer,
  pathname: string,
): Promise<Response> {
  const resolution = engine.resolve(pathname);
  if (!resolution.ok) {
    return resolution.reason === "invalid_segment"
      ? text_response(400, "invalid page URL")
      : text_response(404, "page not found");
  }
  const delivery = await deliverer.deliver(resolution.locator);
  if (!delivery.ok) {
    return delivery.reason === "not_found"
      ? text_response(404, "page not found")
      : text_response(500, "page content is not deliverable");
  }
  const { page, payload } = delivery;
  return new Response(payload.body as BodyInit, {
    status: 200,
    headers: {
      "content-type": payload.media_type,
      "content-length": String(page.content.meta.size_bytes),
      // Guest pages are replaceable in place; no caching until validators
      // (etag/last-modified) are introduced.
      "cache-control": "no-store",
      "content-disposition": content_disposition(payload.download_filename),
    },
  });
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

/**
 * `inline` unless the payload asks for a download; then an `attachment`
 * with an ASCII fallback filename plus an RFC 5987 `filename*` so non-ASCII
 * names survive.
 */
function content_disposition(download_filename?: string): string {
  if (download_filename === undefined) return "inline";
  const fallback = download_filename
    .replaceAll(/["\\\r\n]/g, "_")
    .replaceAll(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(download_filename).replaceAll(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
