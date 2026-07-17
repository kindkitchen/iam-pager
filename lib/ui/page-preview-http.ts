import type { MdPageHandler } from "../content/md-page.ts";
import {
  is_json_media_type,
  read_bounded_request_text,
} from "../http/request-body.ts";

export const page_preview_request_max_bytes = 96 * 1024;

interface PagePreviewBody {
  md: string;
  css?: string;
}

/** UI-only HTTP adapter; rendering remains owned by the MdPage content handler. */
export async function preview_md_page_request(
  request: Request,
  handler: MdPageHandler,
): Promise<Response> {
  if (!is_json_media_type(request.headers.get("content-type"))) {
    return error_response(415, "content-type must be application/json");
  }

  const body_read = await read_bounded_request_text(
    request,
    page_preview_request_max_bytes,
  );
  if (!body_read.ok) {
    return body_read.reason === "too_large"
      ? error_response(413, "preview request is too large")
      : error_response(400, "preview request could not be read");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(body_read.text);
  } catch {
    return error_response(400, "preview request is not valid JSON");
  }
  const input = decode_body(decoded);
  if (input === null) {
    return error_response(400, "md and optional css must be strings");
  }

  const validated = handler.validate(input);
  if (!validated.ok) return error_response(422, validated.reason);
  const payload = handler.render(handler.derive(validated.value));
  if (typeof payload.body !== "string") {
    return error_response(500, "Markdown preview did not render as text");
  }
  return new Response(payload.body, {
    headers: {
      "content-type": payload.media_type,
      "cache-control": "no-store",
    },
  });
}

function decode_body(input: unknown): PagePreviewBody | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const { md, css } = input as Record<string, unknown>;
  if (
    typeof md !== "string" ||
    (css !== undefined && typeof css !== "string")
  ) {
    return null;
  }
  return css === undefined ? { md } : { md, css };
}

function error_response(status: number, detail: string): Response {
  return Response.json(
    { ok: false, detail },
    { status, headers: { "cache-control": "no-store" } },
  );
}
