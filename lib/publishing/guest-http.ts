import type { PagePublisher, PublishResult } from "./interfaces.ts";

/** Keeps unauthenticated JSON parsing bounded before content validation runs. */
export const guest_publish_request_max_bytes = 96 * 1024;

interface GuestPublishBody {
  namespace: string;
  page_name?: string;
  md: string;
  css?: string;
}

type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "unreadable" };

type BodyDecodeResult =
  | { ok: true; value: GuestPublishBody }
  | { ok: false; detail: string };

/**
 * HTTP adapter for unauthenticated MdPage placement (EX-PUBLISH, QT-API).
 * All content and locator rules remain in PagePublisher; this boundary only
 * enforces the JSON contract, bounds request buffering, and maps outcomes.
 */
export async function publish_guest_md_page_request(
  request: Request,
  publisher: PagePublisher,
): Promise<Response> {
  if (!is_json_media_type(request.headers.get("content-type"))) {
    return error_response(
      415,
      "unsupported_media_type",
      "content-type must be application/json",
    );
  }

  const body_read = await read_request_body(
    request,
    guest_publish_request_max_bytes,
  );
  if (!body_read.ok) {
    return body_read.reason === "too_large"
      ? error_response(
        413,
        "request_too_large",
        `request body exceeds ${guest_publish_request_max_bytes} bytes`,
      )
      : error_response(400, "invalid_json", "request body could not be read");
  }

  let input: unknown;
  try {
    input = JSON.parse(body_read.text);
  } catch {
    return error_response(
      400,
      "invalid_json",
      "request body is not valid JSON",
    );
  }
  const decoded = decode_guest_publish_body(input);
  if (!decoded.ok) {
    return error_response(400, "invalid_request", decoded.detail);
  }

  const result = await publisher.publish({
    locator: decoded.value.page_name === undefined
      ? { namespace: decoded.value.namespace }
      : {
        namespace: decoded.value.namespace,
        page_name: decoded.value.page_name,
      },
    content_type: "md-page",
    input: decoded.value.css === undefined
      ? { md: decoded.value.md }
      : { md: decoded.value.md, css: decoded.value.css },
  });
  return publish_result_response(request.url, result);
}

function decode_guest_publish_body(input: unknown): BodyDecodeResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, detail: "request body must be an object" };
  }
  const { namespace, page_name, md, css } = input as Record<string, unknown>;
  if (typeof namespace !== "string") {
    return { ok: false, detail: "namespace must be a string" };
  }
  if (page_name !== undefined && typeof page_name !== "string") {
    return { ok: false, detail: "page_name must be a string when present" };
  }
  if (typeof md !== "string") {
    return { ok: false, detail: "md must be a string" };
  }
  if (css !== undefined && typeof css !== "string") {
    return { ok: false, detail: "css must be a string when present" };
  }
  return {
    ok: true,
    value: {
      namespace,
      ...(page_name === undefined ? {} : { page_name }),
      md,
      ...(css === undefined ? {} : { css }),
    },
  };
}

function publish_result_response(
  request_url: string,
  result: PublishResult,
): Response {
  if (result.ok) {
    return json_response(
      201,
      {
        ok: true,
        path: result.path,
        url: new URL(result.path, request_url).href,
      },
      { location: result.path },
    );
  }
  switch (result.reason) {
    case "forbidden_namespace":
      return error_response(
        403,
        result.reason,
        "namespace is reserved by the platform",
      );
    case "invalid_locator":
      return error_response(
        422,
        result.reason,
        "namespace or page_name cannot be mapped to a direct URL",
      );
    case "invalid_input":
      return error_response(422, result.reason, result.detail);
    case "unknown_content_type":
      return error_response(
        500,
        result.reason,
        "MdPage publishing is unavailable",
      );
  }
}

function is_json_media_type(content_type: string | null): boolean {
  return content_type?.split(";", 1)[0].trim().toLowerCase() ===
    "application/json";
}

async function read_request_body(
  request: Request,
  max_bytes: number,
): Promise<BodyReadResult> {
  const declared_length = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared_length) && declared_length > max_bytes) {
    return { ok: false, reason: "too_large" };
  }
  if (request.body === null) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total_bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total_bytes += value.byteLength;
      if (total_bytes > max_bytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total_bytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

function error_response(
  status: number,
  error: string,
  detail: string,
): Response {
  return json_response(status, { ok: false, error, detail });
}

function json_response(
  status: number,
  body: unknown,
  extra_headers?: HeadersInit,
): Response {
  const headers = new Headers(extra_headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}
