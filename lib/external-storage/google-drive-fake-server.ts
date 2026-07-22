interface FakeDriveFile {
  readonly file_id: string;
  readonly name: string;
  readonly media_type: string;
  readonly body: Uint8Array;
  readonly md5_checksum: string;
  readonly trashed: boolean;
}

interface FakeFailure {
  readonly status: number;
  readonly reason?: string;
  readonly retry_after_seconds?: number;
}

/** In-process Drive/token HTTP fake used by conformance and gateway tests. */
export class FakeGoogleDriveServer {
  readonly drive_api_base_url = "https://drive.test/drive/v3";
  readonly drive_upload_base_url = "https://drive.test/upload/drive/v3";
  readonly token_url = "https://drive.test/oauth2/token";

  readonly #files = new Map<string, FakeDriveFile>();
  readonly #failures = new Map<string, FakeFailure>();
  readonly #access_tokens = new Set<string>();
  readonly #refreshes = new Map<
    string,
    { access_token: string; expires_in: number; refresh_token?: string } | null
  >();
  #sequence = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href.startsWith(this.token_url)) {
      return await this.#handle_token(request);
    }
    if (!this.#is_authorized(request)) {
      return json_response({ error: { message: "unauthorized" } }, 401);
    }
    if (
      url.pathname === "/upload/drive/v3/files" && request.method === "POST"
    ) return await this.#handle_upload(request);
    const match = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (match === null) return new Response(null, { status: 404 });
    const file_id = decodeURIComponent(match[1]);
    const failure = this.#failures.get(file_id);
    if (failure !== undefined) return failure_response(failure);
    const file = this.#files.get(file_id);
    if (file === undefined) return new Response(null, { status: 404 });
    if (url.searchParams.get("alt") === "media") {
      return new Response(file.body.slice(), {
        headers: {
          "content-type": file.media_type,
          "content-length": String(file.body.byteLength),
        },
      });
    }
    return json_response(file_json(file));
  };

  authorize_access_token(access_token: string): void {
    this.#access_tokens.add(access_token);
  }

  deny_access_token(access_token: string): void {
    this.#access_tokens.delete(access_token);
  }

  allow_refresh(
    refresh_token: string,
    result: {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
    },
  ): void {
    this.#refreshes.set(refresh_token, {
      access_token: result.access_token,
      expires_in: result.expires_in ?? 3600,
      ...(result.refresh_token === undefined
        ? {}
        : { refresh_token: result.refresh_token }),
    });
    this.#access_tokens.add(result.access_token);
  }

  reject_refresh(refresh_token: string): void {
    this.#refreshes.set(refresh_token, null);
  }

  async seed_file(input: {
    file_id: string;
    body: Uint8Array;
    media_type?: string;
    name?: string;
    md5_checksum?: string;
    trashed?: boolean;
  }): Promise<string> {
    const checksum = input.md5_checksum ?? await fake_checksum(input.body);
    this.#files.set(input.file_id, {
      file_id: input.file_id,
      body: input.body.slice(),
      media_type: input.media_type ?? "application/octet-stream",
      name: input.name ?? input.file_id,
      md5_checksum: checksum,
      trashed: input.trashed ?? false,
    });
    return checksum;
  }

  set_trashed(file_id: string, trashed: boolean): void {
    const file = this.#files.get(file_id);
    if (file === undefined) {
      throw new Error(`unknown fake Drive file: ${file_id}`);
    }
    this.#files.set(file_id, { ...file, trashed });
  }

  set_failure(file_id: string, failure: FakeFailure | null): void {
    if (failure === null) this.#failures.delete(file_id);
    else this.#failures.set(file_id, failure);
  }

  #is_authorized(request: Request): boolean {
    const authorization = request.headers.get("authorization");
    return authorization?.startsWith("Bearer ") === true &&
      this.#access_tokens.has(authorization.slice("Bearer ".length));
  }

  async #handle_token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const refresh_token = form.get("refresh_token") ?? "";
    const result = this.#refreshes.get(refresh_token);
    if (result === undefined || result === null) {
      return json_response({ error: "invalid_grant" }, 400);
    }
    return json_response(result);
  }

  async #handle_upload(request: Request): Promise<Response> {
    const content_type = request.headers.get("content-type") ?? "";
    const boundary = /boundary=([^;]+)/.exec(content_type)?.[1];
    if (boundary === undefined) return new Response(null, { status: 400 });
    const parsed = parse_multipart_related(
      new Uint8Array(await request.arrayBuffer()),
      boundary,
    );
    if (parsed === null) return new Response(null, { status: 400 });
    let metadata: unknown;
    try {
      metadata = JSON.parse(new TextDecoder().decode(parsed.metadata));
    } catch {
      return new Response(null, { status: 400 });
    }
    const name = typeof metadata === "object" && metadata !== null &&
        !Array.isArray(metadata) &&
        typeof (metadata as Record<string, unknown>).name === "string"
      ? (metadata as Record<string, string>).name
      : "iam-pager-content";
    const file_id = `drive-file-${++this.#sequence}`;
    const checksum = await fake_checksum(parsed.body);
    const file: FakeDriveFile = {
      file_id,
      name,
      media_type: parsed.media_type,
      body: parsed.body.slice(),
      md5_checksum: checksum,
      trashed: false,
    };
    this.#files.set(file_id, file);
    return json_response(file_json(file));
  }
}

function parse_multipart_related(
  body: Uint8Array,
  boundary: string,
): { metadata: Uint8Array; media_type: string; body: Uint8Array } | null {
  const marker = encode(`--${boundary}`);
  const positions: number[] = [];
  let offset = 0;
  while (true) {
    const position = index_of(body, marker, offset);
    if (position < 0) break;
    positions.push(position);
    offset = position + marker.byteLength;
  }
  if (positions.length < 3) return null;
  const metadata_part = trim_crlf(
    body.slice(positions[0] + marker.byteLength, positions[1]),
  );
  const media_part = trim_crlf(
    body.slice(positions[1] + marker.byteLength, positions[2]),
  );
  const separator = encode("\r\n\r\n");
  const metadata_header_end = index_of(metadata_part, separator);
  const media_header_end = index_of(media_part, separator);
  if (metadata_header_end < 0 || media_header_end < 0) return null;
  const media_headers = new TextDecoder().decode(
    media_part.slice(0, media_header_end),
  );
  const media_type = /(?:^|\r\n)content-type:\s*([^\r\n]+)/i.exec(
    media_headers,
  )?.[1];
  if (media_type === undefined) return null;
  return {
    metadata: metadata_part.slice(metadata_header_end + separator.byteLength),
    media_type,
    body: media_part.slice(media_header_end + separator.byteLength),
  };
}

function file_json(file: FakeDriveFile): Record<string, unknown> {
  return {
    id: file.file_id,
    size: String(file.body.byteLength),
    md5Checksum: file.md5_checksum,
    trashed: file.trashed,
  };
}

function failure_response(failure: FakeFailure): Response {
  return json_response(
    {
      error: {
        errors: failure.reason === undefined
          ? []
          : [{ reason: failure.reason }],
      },
    },
    failure.status,
    failure.retry_after_seconds === undefined ? {} : {
      "retry-after": String(failure.retry_after_seconds),
    },
  );
}

function json_response(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      ...Object.fromEntries(new Headers(headers)),
      "content-type": "application/json",
    },
  });
}

async function fake_checksum(body: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", body.slice().buffer as ArrayBuffer),
  );
  return Array.from(digest.slice(0, 16))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function trim_crlf(value: Uint8Array): Uint8Array {
  let start = 0;
  let end = value.byteLength;
  if (value[0] === 13 && value[1] === 10) start = 2;
  if (value[end - 2] === 13 && value[end - 1] === 10) end -= 2;
  return value.slice(start, end);
}

function index_of(
  haystack: Uint8Array,
  needle: Uint8Array,
  from = 0,
): number {
  outer: for (
    let index = from;
    index <= haystack.length - needle.length;
    index++
  ) {
    for (let part = 0; part < needle.length; part++) {
      if (haystack[index + part] !== needle[part]) continue outer;
    }
    return index;
  }
  return -1;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
