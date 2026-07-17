export type BoundedBodyReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "unreadable" };

export function is_json_media_type(content_type: string | null): boolean {
  return content_type?.split(";", 1)[0].trim().toLowerCase() ===
    "application/json";
}

/** Read a request body without buffering more than the declared byte limit. */
export async function read_bounded_request_text(
  request: Request,
  max_bytes: number,
): Promise<BoundedBodyReadResult> {
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
