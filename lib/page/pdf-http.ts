import { default_pdf_limits, pdf_media_type } from "../content/pdf.ts";
import { read_bounded_request_bytes } from "../http/request-body.ts";
import type { DeliveryProfile } from "../content/model.ts";
import type { Locator } from "../locator/model.ts";
import type { PageEndpointSetIntent } from "./endpoint.ts";
import type { PageAccess } from "./model.ts";

export const pdf_multipart_metadata_max_bytes = 16 * 1024;
export const pdf_multipart_max_bytes = default_pdf_limits.max_bytes + 64 * 1024;

export interface PdfMultipartCreateCommand {
  readonly endpoint_set: PageEndpointSetIntent;
  readonly access: PageAccess;
  readonly tags?: string[];
  readonly content: {
    readonly content_type: "pdf";
    readonly input: { readonly bytes: Uint8Array; readonly filename: string };
  };
}

export interface PdfMultipartUpdateCommand {
  readonly endpoint_set: PageEndpointSetIntent;
  readonly access?: PageAccess;
  readonly tags?: string[];
  readonly content: PdfMultipartCreateCommand["content"];
}

export type PdfMultipartDecodeFailure = {
  readonly ok: false;
  readonly reason:
    | "unsupported_media_type"
    | "too_large"
    | "unreadable"
    | "malformed_multipart"
    | "invalid_json"
    | "invalid_metadata";
  readonly detail: string;
};

export type PdfMultipartDecodeResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | PdfMultipartDecodeFailure;

/** HTTP-edge capability that turns bounded multipart parts into pure PDF commands. */
export interface PdfMultipartDecoder {
  decode_create(
    request: Request,
  ): Promise<PdfMultipartDecodeResult<PdfMultipartCreateCommand>>;
  decode_update(
    request: Request,
  ): Promise<PdfMultipartDecodeResult<PdfMultipartUpdateCommand>>;
}

interface ParsedPdfMultipart {
  readonly metadata: unknown;
  readonly bytes: Uint8Array;
  readonly filename: string;
}

type DecodeResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly detail: string };

/** Strict two-part, bounded multipart decoder independent from Fresh routing. */
export class WebPdfMultipartDecoder implements PdfMultipartDecoder {
  async decode_create(
    request: Request,
  ): Promise<PdfMultipartDecodeResult<PdfMultipartCreateCommand>> {
    const parsed = await parse_pdf_multipart(request);
    if (!parsed.ok) return parsed;
    const metadata = decode_create_metadata(parsed.value.metadata);
    if (!metadata.ok) return invalid_metadata(metadata.detail);
    return {
      ok: true,
      value: {
        ...metadata.value,
        content: pdf_content(parsed.value),
      },
    };
  }

  async decode_update(
    request: Request,
  ): Promise<PdfMultipartDecodeResult<PdfMultipartUpdateCommand>> {
    const parsed = await parse_pdf_multipart(request);
    if (!parsed.ok) return parsed;
    const metadata = decode_update_metadata(parsed.value.metadata);
    if (!metadata.ok) return invalid_metadata(metadata.detail);
    return {
      ok: true,
      value: {
        ...metadata.value,
        content: pdf_content(parsed.value),
      },
    };
  }
}

async function parse_pdf_multipart(
  request: Request,
): Promise<PdfMultipartDecodeResult<ParsedPdfMultipart>> {
  const content_type = request.headers.get("content-type");
  const boundary = multipart_boundary(content_type);
  if (boundary === null) {
    return {
      ok: false,
      reason: "unsupported_media_type",
      detail:
        "content-type must be multipart/form-data with one strict boundary",
    };
  }
  const body = await read_bounded_request_bytes(
    request,
    pdf_multipart_max_bytes,
  );
  if (!body.ok) {
    return {
      ok: false,
      reason: body.reason,
      detail: body.reason === "too_large"
        ? `multipart body exceeds ${pdf_multipart_max_bytes} bytes`
        : "multipart body could not be read",
    };
  }
  if (!has_complete_multipart_framing(body.bytes, boundary)) {
    return {
      ok: false,
      reason: "malformed_multipart",
      detail: "multipart body has malformed boundary framing",
    };
  }

  let form: FormData;
  try {
    form = await new Response(body.bytes as BodyInit, {
      headers: { "content-type": content_type! },
    }).formData();
  } catch {
    return {
      ok: false,
      reason: "malformed_multipart",
      detail: "multipart body could not be parsed",
    };
  }
  const entries = [...form.entries()];
  if (
    entries.length !== 2 || form.getAll("metadata").length !== 1 ||
    form.getAll("file").length !== 1 ||
    entries.some(([name]) => name !== "metadata" && name !== "file")
  ) {
    return {
      ok: false,
      reason: "malformed_multipart",
      detail:
        "multipart body must contain exactly one metadata part and one file part",
    };
  }
  const metadata_part = form.get("metadata");
  const file_part = form.get("file");
  if (
    !(metadata_part instanceof File) || metadata_part.name !== "metadata.json"
  ) {
    return {
      ok: false,
      reason: "malformed_multipart",
      detail: "metadata must be a file part named metadata.json",
    };
  }
  if (metadata_part.type.toLowerCase() !== "application/json") {
    return {
      ok: false,
      reason: "unsupported_media_type",
      detail: "metadata part content-type must be application/json",
    };
  }
  if (metadata_part.size > pdf_multipart_metadata_max_bytes) {
    return {
      ok: false,
      reason: "too_large",
      detail: `metadata part exceeds ${pdf_multipart_metadata_max_bytes} bytes`,
    };
  }
  if (!(file_part instanceof File) || file_part.name === "") {
    return {
      ok: false,
      reason: "malformed_multipart",
      detail: "file must be one named file part",
    };
  }
  if (file_part.type.toLowerCase() !== pdf_media_type) {
    return {
      ok: false,
      reason: "unsupported_media_type",
      detail: `file part content-type must be ${pdf_media_type}`,
    };
  }
  if (file_part.size > default_pdf_limits.max_bytes) {
    return {
      ok: false,
      reason: "too_large",
      detail: `PDF file exceeds ${default_pdf_limits.max_bytes} bytes`,
    };
  }

  let metadata: unknown;
  try {
    const metadata_bytes = new Uint8Array(await metadata_part.arrayBuffer());
    const metadata_text = new TextDecoder("utf-8", { fatal: true }).decode(
      metadata_bytes,
    );
    metadata = JSON.parse(metadata_text);
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      detail: "metadata part is not valid UTF-8 JSON",
    };
  }
  return {
    ok: true,
    value: {
      metadata,
      bytes: new Uint8Array(await file_part.arrayBuffer()),
      filename: file_part.name,
    },
  };
}

function pdf_content(parsed: ParsedPdfMultipart) {
  return {
    content_type: "pdf" as const,
    input: { bytes: parsed.bytes, filename: parsed.filename },
  };
}

function decode_create_metadata(input: unknown): DecodeResult<{
  endpoint_set: PageEndpointSetIntent;
  access: PageAccess;
  tags?: string[];
}> {
  const body = strict_object(input, ["endpoint_set", "access", "tags?"]);
  if (!body.ok) return body;
  if (typeof body.value.access !== "string") {
    return { ok: false, detail: "access must be a string" };
  }
  const endpoint_set = decode_pdf_endpoint_set(body.value.endpoint_set);
  if (!endpoint_set.ok) return endpoint_set;
  const tags = decode_tags(body.value.tags);
  if (!tags.ok) return tags;
  return {
    ok: true,
    value: {
      endpoint_set: endpoint_set.value,
      access: body.value.access as PageAccess,
      ...(tags.value === undefined ? {} : { tags: tags.value }),
    },
  };
}

function decode_update_metadata(input: unknown): DecodeResult<{
  endpoint_set: PageEndpointSetIntent;
  access?: PageAccess;
  tags?: string[];
}> {
  const body = strict_object(input, ["endpoint_set", "access?", "tags?"]);
  if (!body.ok) return body;
  if (
    body.value.access !== undefined && typeof body.value.access !== "string"
  ) {
    return { ok: false, detail: "access must be a string when present" };
  }
  const endpoint_set = decode_pdf_endpoint_set(body.value.endpoint_set);
  if (!endpoint_set.ok) return endpoint_set;
  const tags = decode_tags(body.value.tags);
  if (!tags.ok) return tags;
  return {
    ok: true,
    value: {
      endpoint_set: endpoint_set.value,
      ...(body.value.access === undefined
        ? {}
        : { access: body.value.access as PageAccess }),
      ...(tags.value === undefined ? {} : { tags: tags.value }),
    },
  };
}

function decode_pdf_endpoint_set(
  input: unknown,
): DecodeResult<PageEndpointSetIntent> {
  const set = strict_object(input, ["canonical", "alternates"]);
  if (!set.ok) return prefixed(set, "endpoint_set");
  if (!Array.isArray(set.value.alternates)) {
    return { ok: false, detail: "endpoint_set.alternates must be an array" };
  }
  const canonical = decode_endpoint_binding(set.value.canonical);
  if (!canonical.ok) return prefixed(canonical, "endpoint_set.canonical");
  const alternates = [];
  for (const [index, value] of set.value.alternates.entries()) {
    const decoded = decode_endpoint_binding(value);
    if (!decoded.ok) {
      return prefixed(decoded, `endpoint_set.alternates[${index}]`);
    }
    alternates.push(decoded.value);
  }
  if (canonical.value.delivery_profile !== "inline") {
    return {
      ok: false,
      detail: "endpoint_set.canonical.delivery_profile must be inline",
    };
  }
  if (
    !alternates.some((endpoint) => endpoint.delivery_profile === "attachment")
  ) {
    return {
      ok: false,
      detail: "endpoint_set must include an attachment alternate",
    };
  }
  return {
    ok: true,
    value: { canonical: canonical.value, alternates },
  };
}

function decode_endpoint_binding(
  input: unknown,
): DecodeResult<{ locator: Locator; delivery_profile: DeliveryProfile }> {
  const binding = strict_object(input, ["locator", "delivery_profile"]);
  if (!binding.ok) return binding;
  const locator = strict_object(binding.value.locator, [
    "namespace",
    "page_name?",
  ]);
  if (!locator.ok) return prefixed(locator, "locator");
  if (typeof locator.value.namespace !== "string") {
    return { ok: false, detail: "locator.namespace must be a string" };
  }
  if (
    locator.value.page_name !== undefined &&
    typeof locator.value.page_name !== "string"
  ) {
    return {
      ok: false,
      detail: "locator.page_name must be a string when present",
    };
  }
  if (typeof binding.value.delivery_profile !== "string") {
    return { ok: false, detail: "delivery_profile must be a string" };
  }
  return {
    ok: true,
    value: {
      locator: locator.value.page_name === undefined
        ? { namespace: locator.value.namespace }
        : {
          namespace: locator.value.namespace,
          page_name: locator.value.page_name,
        },
      delivery_profile: binding.value.delivery_profile as DeliveryProfile,
    },
  };
}

function decode_tags(input: unknown): DecodeResult<string[] | undefined> {
  if (input === undefined) return { ok: true, value: undefined };
  if (
    !Array.isArray(input) || input.some((value) => typeof value !== "string")
  ) {
    return {
      ok: false,
      detail: "tags must be an array of strings when present",
    };
  }
  return { ok: true, value: input as string[] };
}

function strict_object(
  input: unknown,
  fields: readonly string[],
): DecodeResult<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, detail: "value must be an object" };
  }
  const value = input as Record<string, unknown>;
  const required = fields.filter((field) => !field.endsWith("?"));
  const allowed = fields.map((field) => field.replace(/\?$/, ""));
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    return { ok: false, detail: `unknown field: ${unknown}` };
  }
  const missing = required.find((field) => !Object.hasOwn(value, field));
  if (missing !== undefined) {
    return { ok: false, detail: `missing field: ${missing}` };
  }
  return { ok: true, value };
}

function prefixed(
  result: { readonly ok: false; readonly detail: string },
  prefix: string,
): { readonly ok: false; readonly detail: string } {
  return { ok: false, detail: `${prefix}: ${result.detail}` };
}

function invalid_metadata(detail: string): PdfMultipartDecodeFailure {
  return { ok: false, reason: "invalid_metadata", detail };
}

function multipart_boundary(content_type: string | null): string | null {
  if (content_type === null) return null;
  const match =
    /^multipart\/form-data\s*;\s*boundary=([A-Za-z0-9'()+_,.\/:=?-]{1,70})$/i
      .exec(content_type);
  return match?.[1] ?? null;
}

function has_complete_multipart_framing(
  bytes: Uint8Array,
  boundary: string,
): boolean {
  const decoder = new TextDecoder("ascii");
  const first = decoder.decode(bytes.subarray(0, boundary.length + 4));
  if (first !== `--${boundary}\r\n`) return false;
  const terminal = new TextEncoder().encode(`\r\n--${boundary}--`);
  const has_trailing_crlf = bytes.byteLength >= 2 &&
    bytes[bytes.byteLength - 2] === 0x0d &&
    bytes[bytes.byteLength - 1] === 0x0a;
  const offset = bytes.byteLength - terminal.byteLength -
    (has_trailing_crlf ? 2 : 0);
  if (offset < 0) return false;
  for (let index = 0; index < terminal.byteLength; index += 1) {
    if (bytes[offset + index] !== terminal[index]) return false;
  }
  return true;
}
