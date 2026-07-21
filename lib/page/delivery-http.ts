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

/** Maps a direct locator request to a response without Fresh route logic. */
export async function deliver_page_locator_path(
  engine: LocatorEngine,
  deliverer: PageDeliverer,
  request_or_pathname: Request | string,
  actor: PageActor,
  request_id?: string,
): Promise<Response> {
  const request = typeof request_or_pathname === "string"
    ? null
    : request_or_pathname;
  const pathname = typeof request_or_pathname === "string"
    ? request_or_pathname
    : new URL(request_or_pathname.url).pathname;
  const resolution = engine.resolve(pathname);
  if (!resolution.ok) {
    return resolution.reason === "invalid_segment"
      ? text_response(400, "invalid page URL", request_id)
      : text_response(404, "page not found", request_id);
  }
  const delivery = await deliverer.deliver(resolution.locator, actor);
  if (!delivery.ok) {
    return delivery.reason === "not_found"
      ? text_response(404, "page not found", request_id)
      : text_response(500, "page content is not deliverable", request_id);
  }
  const { endpoint, page, payload } = delivery;
  const etag = await direct_delivery_etag(page.page_id, page.revision);
  const headers = new Headers({
    "content-type": payload.media_type,
    "content-length": String(page.size_bytes),
    "cache-control": "no-store",
    "content-disposition": content_disposition(
      endpoint.delivery_profile,
      payload.download_filename,
    ),
    "x-content-type-options": "nosniff",
    etag,
  });
  if (request_id !== undefined) headers.set("x-request-id", request_id);
  if (is_active_content(payload.media_type)) {
    headers.set(
      "content-security-policy",
      "sandbox; default-src 'none'; img-src https: data:; " +
        "style-src 'unsafe-inline'",
    );
  }

  if (
    request !== null && etag_matches(request.headers.get("if-none-match"), etag)
  ) {
    return new Response(null, {
      status: 304,
      headers: response_headers(headers, [
        "cache-control",
        "etag",
        "x-request-id",
      ]),
    });
  }

  if (is_pdf_binary_payload(payload.media_type, payload.body)) {
    if (payload.body.byteLength !== page.size_bytes) {
      return text_response(500, "page content is not deliverable", request_id);
    }
    headers.set("accept-ranges", "bytes");
    const range_header = request?.headers.get("range") ?? null;
    const if_range = request?.headers.get("if-range") ?? null;
    if (range_header !== null && (if_range === null || if_range === etag)) {
      const range = parse_single_byte_range(
        range_header,
        payload.body.byteLength,
      );
      if (range === null) {
        headers.set("content-range", `bytes */${payload.body.byteLength}`);
        headers.delete("content-length");
        return new Response(null, { status: 416, headers });
      }
      const body = payload.body.slice(range.start, range.end + 1);
      headers.set(
        "content-range",
        `bytes ${range.start}-${range.end}/${payload.body.byteLength}`,
      );
      headers.set("content-length", String(body.byteLength));
      return new Response(body as BodyInit, { status: 206, headers });
    }
  }

  return new Response(payload.body as BodyInit, { status: 200, headers });
}

function is_active_content(media_type: string): boolean {
  const type = media_type.split(";", 1)[0].trim().toLowerCase();
  return type === "text/html" || type === "image/svg+xml";
}

function is_pdf_binary_payload(
  media_type: string,
  body: string | Uint8Array,
): body is Uint8Array {
  return body instanceof Uint8Array &&
    media_type.split(";", 1)[0].trim().toLowerCase() === "application/pdf";
}

function text_response(
  status: number,
  message: string,
  request_id?: string,
): Response {
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  if (request_id !== undefined) headers.set("x-request-id", request_id);
  return new Response(message + "\n", { status, headers });
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

function parse_single_byte_range(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(header);
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix_length = Number(match[2]);
    if (!Number.isSafeInteger(suffix_length) || suffix_length < 1) return null;
    return { start: Math.max(0, size - suffix_length), end: size - 1 };
  }
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start >= size) return null;
  if (match[2] === "") return { start, end: size - 1 };
  const requested_end = Number(match[2]);
  if (!Number.isSafeInteger(requested_end) || requested_end < start) {
    return null;
  }
  return { start, end: Math.min(requested_end, size - 1) };
}

function etag_matches(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === etag || value === `W/${etag}`;
  });
}

async function direct_delivery_etag(
  page_id: string,
  revision: number,
): Promise<string> {
  const input = new TextEncoder().encode(`${page_id}:${revision}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  let binary = "";
  for (const byte of digest.subarray(0, 18)) {
    binary += String.fromCharCode(byte);
  }
  const opaque = btoa(binary).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
  return `"content-${opaque}"`;
}

function response_headers(headers: Headers, names: readonly string[]): Headers {
  const selected = new Headers();
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) selected.set(name, value);
  }
  return selected;
}
