import type { ContentResult, ContentTypeHandler } from "./interfaces.ts";
import type { DeliveryPayload } from "./model.ts";

export const pdf_media_type = "application/pdf" as const;
export const max_pdf_filename_bytes = 255;
export const supported_pdf_versions = [
  "1.0",
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.5",
  "1.6",
  "1.7",
  "2.0",
] as const;

export type PdfVersion = (typeof supported_pdf_versions)[number];

export interface PdfInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
}

export interface PdfData {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly pdf_version: PdfVersion;
}

/** Bounded owner-safe projection; complete PDF bytes never enter inspection JSON. */
export interface PdfManagementRepresentation {
  readonly filename: string;
  readonly media_type: typeof pdf_media_type;
  readonly size_bytes: number;
  readonly pdf_version: PdfVersion;
  readonly replaceable: true;
}

export interface PdfLimits {
  readonly max_bytes: number;
}

/** Bounded full-file policy; range and streaming behavior belong to HTTP. */
export const default_pdf_limits: Readonly<PdfLimits> = {
  max_bytes: 16 * 1024 * 1024,
};

const text_encoder = new TextEncoder();
const pdf_prefix = text_encoder.encode("%PDF-");
const startxref_token = text_encoder.encode("startxref");
const eof_token = text_encoder.encode("%%EOF");
const xref_token = text_encoder.encode("xref");
const obj_token = text_encoder.encode("obj");
const type_token = text_encoder.encode("/Type");
const xref_name_token = text_encoder.encode("/XRef");
const stream_token = text_encoder.encode("stream");
const supported_version_set = new Set<string>(supported_pdf_versions);
const unsafe_portable_filename_characters = new Set('<>:"/\\|?*');
const reserved_filename_pattern =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * Explicit PDF capability. Validation is intentionally lightweight structural
 * screening, not sanitization, exploit detection, or malware certification.
 */
export class PdfHandler
  implements
    ContentTypeHandler<PdfInput, PdfData, PdfManagementRepresentation> {
  readonly content_type = "pdf";
  readonly canonical_codec_version = "pdf-v1";
  readonly supported_delivery_profiles = ["inline", "attachment"] as const;
  readonly #max_bytes: number;

  constructor(limits: PdfLimits = default_pdf_limits) {
    if (!Number.isSafeInteger(limits.max_bytes) || limits.max_bytes < 1) {
      throw new Error("Pdf limits must be a positive safe integer");
    }
    this.#max_bytes = limits.max_bytes;
  }

  validate(input: unknown): ContentResult<PdfInput> {
    if (
      typeof input !== "object" || input === null || Array.isArray(input)
    ) {
      return { ok: false, reason: "input must be an object" };
    }
    const { bytes, filename } = input as Record<string, unknown>;
    if (!(bytes instanceof Uint8Array)) {
      return { ok: false, reason: "bytes must be a Uint8Array" };
    }
    if (typeof filename !== "string") {
      return { ok: false, reason: "filename must be a non-empty string" };
    }
    const filename_error = pdf_filename_violation(filename);
    if (filename_error !== null) {
      return { ok: false, reason: filename_error };
    }
    if (bytes.byteLength === 0) {
      return { ok: false, reason: "bytes must not be empty" };
    }
    if (bytes.byteLength > this.#max_bytes) {
      return {
        ok: false,
        reason: `pdf exceeds ${this.#max_bytes} bytes`,
      };
    }
    if (read_pdf_version(bytes) === null) {
      return {
        ok: false,
        reason: "bytes must begin with a supported PDF header (1.0-1.7 or 2.0)",
      };
    }
    if (!has_valid_pdf_terminal_structure(bytes)) {
      return {
        ok: false,
        reason: "bytes must end with a valid PDF startxref/%%EOF structure",
      };
    }
    return {
      ok: true,
      value: { bytes: bytes.slice(), filename },
    };
  }

  derive(input: PdfInput): PdfData {
    const pdf_version = read_pdf_version(input.bytes);
    if (pdf_version === null) {
      throw new Error("PdfHandler derive requires validated input");
    }
    return {
      bytes: input.bytes.slice(),
      filename: input.filename,
      pdf_version,
    };
  }

  to_management(data: PdfData): PdfManagementRepresentation {
    return {
      filename: data.filename,
      media_type: pdf_media_type,
      size_bytes: data.bytes.byteLength,
      pdf_version: data.pdf_version,
      replaceable: true,
    };
  }

  render(data: PdfData): DeliveryPayload {
    return {
      body: data.bytes.slice(),
      media_type: pdf_media_type,
      download_filename: data.filename,
    };
  }
}

/** First portable filename-policy violation, or null for accepted metadata. */
export function pdf_filename_violation(filename: unknown): string | null {
  if (typeof filename !== "string" || filename === "") {
    return "filename must be a non-empty string";
  }
  if (filename === "." || filename === "..") {
    return "filename must name a file";
  }
  if (filename !== filename.trim() || filename.endsWith(".")) {
    return "filename must not have leading or trailing whitespace or dots";
  }
  if (text_encoder.encode(filename).byteLength > max_pdf_filename_bytes) {
    return `filename exceeds ${max_pdf_filename_bytes} UTF-8 bytes`;
  }
  if (has_unsafe_filename_character(filename)) {
    return "filename contains unsafe characters";
  }
  if (reserved_filename_pattern.test(filename)) {
    return "filename is reserved on common filesystems";
  }
  return null;
}

function has_unsafe_filename_character(filename: string): boolean {
  for (const character of filename) {
    const code_point = character.codePointAt(0)!;
    if (
      code_point <= 0x1f ||
      (code_point >= 0x7f && code_point <= 0x9f) ||
      code_point === 0x061c || code_point === 0x200e || code_point === 0x200f ||
      code_point === 0x2028 || code_point === 0x2029 ||
      (code_point >= 0x202a && code_point <= 0x202e) ||
      (code_point >= 0x2066 && code_point <= 0x2069) ||
      unsafe_portable_filename_characters.has(character)
    ) {
      return true;
    }
  }
  return false;
}

function read_pdf_version(bytes: Uint8Array): PdfVersion | null {
  if (bytes.byteLength < pdf_prefix.byteLength + 4) return null;
  if (!matches_at(bytes, 0, pdf_prefix)) return null;
  const version = String.fromCharCode(bytes[5], bytes[6], bytes[7]);
  if (!supported_version_set.has(version)) return null;
  if (bytes[8] !== 0x0a && bytes[8] !== 0x0d) return null;
  return version as PdfVersion;
}

function has_valid_pdf_terminal_structure(bytes: Uint8Array): boolean {
  let content_end = bytes.byteLength;
  while (content_end > 0 && is_pdf_whitespace(bytes[content_end - 1])) {
    content_end -= 1;
  }
  const eof_start = content_end - eof_token.byteLength;
  if (eof_start < 0 || !matches_at(bytes, eof_start, eof_token)) return false;

  const startxref_start = find_last_token_before(
    bytes,
    startxref_token,
    eof_start,
  );
  if (
    startxref_start < 1 ||
    !is_pdf_whitespace(bytes[startxref_start - 1])
  ) {
    return false;
  }

  let cursor = startxref_start + startxref_token.byteLength;
  if (cursor >= eof_start || !is_pdf_whitespace(bytes[cursor])) return false;
  cursor = skip_pdf_whitespace(bytes, cursor, eof_start);
  const parsed_offset = read_ascii_integer(bytes, cursor, eof_start);
  if (parsed_offset === null) return false;
  cursor = skip_pdf_whitespace(bytes, parsed_offset.next, eof_start);
  if (cursor !== eof_start) return false;
  if (
    parsed_offset.value <= 0 || parsed_offset.value >= startxref_start
  ) {
    return false;
  }
  return is_xref_target(bytes, parsed_offset.value, startxref_start);
}

function is_xref_target(
  bytes: Uint8Array,
  offset: number,
  boundary: number,
): boolean {
  if (matches_at(bytes, offset, xref_token)) {
    const next = offset + xref_token.byteLength;
    return next < boundary && is_pdf_whitespace(bytes[next]);
  }

  const object_number = read_ascii_integer(bytes, offset, boundary);
  if (
    object_number === null || object_number.value < 1 ||
    object_number.next >= boundary ||
    !is_pdf_whitespace(bytes[object_number.next])
  ) {
    return false;
  }
  let cursor = skip_pdf_whitespace(bytes, object_number.next, boundary);
  const generation = read_ascii_integer(bytes, cursor, boundary);
  if (
    generation === null || generation.next >= boundary ||
    !is_pdf_whitespace(bytes[generation.next])
  ) {
    return false;
  }
  cursor = skip_pdf_whitespace(bytes, generation.next, boundary);
  if (!matches_at(bytes, cursor, obj_token)) return false;
  const next = cursor + obj_token.byteLength;
  return next < boundary && is_pdf_delimiter(bytes[next]) &&
    is_xref_stream_object(bytes, next, boundary);
}

function is_xref_stream_object(
  bytes: Uint8Array,
  offset: number,
  boundary: number,
): boolean {
  const stream_start = find_pdf_keyword_between(
    bytes,
    stream_token,
    offset,
    boundary,
  );
  if (stream_start < 0) return false;

  for (
    let type_start = find_token_between(
      bytes,
      type_token,
      offset,
      stream_start,
    );
    type_start >= 0;
    type_start = find_token_between(
      bytes,
      type_token,
      type_start + 1,
      stream_start,
    )
  ) {
    if (type_start > 0 && !is_pdf_delimiter(bytes[type_start - 1])) continue;
    const xref_start = skip_pdf_whitespace(
      bytes,
      type_start + type_token.byteLength,
      stream_start,
    );
    const next = xref_start + xref_name_token.byteLength;
    if (
      matches_at(bytes, xref_start, xref_name_token) && next < stream_start &&
      is_pdf_delimiter(bytes[next])
    ) {
      return true;
    }
  }
  return false;
}

function read_ascii_integer(
  bytes: Uint8Array,
  offset: number,
  boundary: number,
): { value: number; next: number } | null {
  let cursor = offset;
  let value = 0;
  while (cursor < boundary && bytes[cursor] >= 0x30 && bytes[cursor] <= 0x39) {
    value = value * 10 + bytes[cursor] - 0x30;
    if (!Number.isSafeInteger(value)) return null;
    cursor += 1;
  }
  return cursor === offset ? null : { value, next: cursor };
}

function find_last_token_before(
  bytes: Uint8Array,
  token: Uint8Array,
  boundary: number,
): number {
  for (let offset = boundary - token.byteLength; offset >= 0; offset -= 1) {
    if (matches_at(bytes, offset, token)) return offset;
  }
  return -1;
}

function find_token_between(
  bytes: Uint8Array,
  token: Uint8Array,
  offset: number,
  boundary: number,
): number {
  for (; offset + token.byteLength <= boundary; offset += 1) {
    if (matches_at(bytes, offset, token)) return offset;
  }
  return -1;
}

function find_pdf_keyword_between(
  bytes: Uint8Array,
  token: Uint8Array,
  offset: number,
  boundary: number,
): number {
  while (offset + token.byteLength < boundary) {
    const found = find_token_between(bytes, token, offset, boundary);
    if (found < 0) return -1;
    const next = found + token.byteLength;
    if (
      next < boundary &&
      (found === 0 || is_pdf_delimiter(bytes[found - 1])) &&
      is_pdf_whitespace(bytes[next])
    ) {
      return found;
    }
    offset = found + 1;
  }
  return -1;
}

function matches_at(
  bytes: Uint8Array,
  offset: number,
  expected: Uint8Array,
): boolean {
  if (offset < 0 || offset + expected.byteLength > bytes.byteLength) {
    return false;
  }
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
}

function skip_pdf_whitespace(
  bytes: Uint8Array,
  offset: number,
  boundary: number,
): number {
  while (offset < boundary && is_pdf_whitespace(bytes[offset])) offset += 1;
  return offset;
}

function is_pdf_whitespace(byte: number): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c ||
    byte === 0x0d || byte === 0x20;
}

function is_pdf_delimiter(byte: number): boolean {
  return is_pdf_whitespace(byte) || byte === 0x28 || byte === 0x29 ||
    byte === 0x3c || byte === 0x3e || byte === 0x5b || byte === 0x5d ||
    byte === 0x7b || byte === 0x7d || byte === 0x2f || byte === 0x25;
}
